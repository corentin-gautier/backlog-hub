// Claude beside each board: a chat with the project's Claude Code conversation, run on the server
// (claude.js) and streamed over a WebSocket as simple events. Uses `frames`, `projects`, `api`,
// `stored` and `store` from app.js, `marked` and `DOMPurify` from vendor/.
const Claude = (() => {
	const panels = {}; // port -> { el, log, socket, tools, draft, busy, mode }
	const shown = new Set(stored('claude', [])); // ports whose panel is open
	const MODES = { default: 'Demander avant d’agir', acceptEdits: 'Accepter les modifications', plan: 'Plan', auto: 'Auto' };
	const SHORT = { default: 'Demander', acceptEdits: 'Modifier', plan: 'Plan', auto: 'Auto' };
	const icon = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
	const ICONS = {
		default: icon('M8 2.2 12.8 4v3.6c0 2.9-2 5-4.8 6.2C5.2 12.6 3.2 10.5 3.2 7.6V4Z'),
		acceptEdits: icon('M10.2 3.3l2.5 2.5-6.9 6.9H3.3v-2.5Z'),
		plan: icon('M3 4.5h10M3 8h10M3 11.5h6'),
		auto: icon('M9 1.8 3.8 9h4.1l-.9 5.2L12.2 7H8.1Z'),
		send: icon('M8 12.5v-9M4 7.5l4-4 4 4'),
		stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5"/></svg>',
	};
	const CYCLE = ['default', 'acceptEdits', 'plan', 'auto'];

	const setWidth = (px) => document.body.style.setProperty('--claude-width', `${px}px`);
	setWidth(stored('claudeWidth', 460));

	const h = (tag, className, text) => {
		const el = document.createElement(tag);
		if (className) el.className = className;
		if (text != null) el.textContent = text;
		return el;
	};
	const REMOTE = /^(https?:|mailto:|data:|blob:)/i;
	const PATH = /^(~|\.{0,2}\/|[\w.-]+\/)?[\w .@+-]*(\/[\w .@+-]+)*\.[a-z]\w{0,7}(:\d+){0,2}$/i;

	// Markdown to safe HTML; local images load through the server, file paths in code become clickable.
	function markdown(text, port) {
		const t = document.createElement('template');
		t.innerHTML = DOMPurify.sanitize(marked.parse(text, { breaks: true }));
		t.content.querySelectorAll('img').forEach((img) => {
			const src = img.getAttribute('src') || '';
			if (REMOTE.test(src)) return;
			img.dataset.path = src;
			img.src = `/api/projects/${port}/image?path=${encodeURIComponent(src)}`;
		});
		t.content.querySelectorAll('a').forEach((a) => {
			a.target = '_blank';
			a.rel = 'noopener';
			a.title = a.getAttribute('href') || '';
		});
		t.content.querySelectorAll(':not(pre) > code').forEach((code) => {
			if (!code.closest('a') && PATH.test(code.textContent.trim())) code.classList.add('path');
		});
		return t.innerHTML;
	}

	// Clicks in the chat: web links open in the browser, files open on the Mac (code in VS Code at its line).
	function openLinks(panel) {
		const open = (ref) => api(`projects/${panel.port}/open`, 'POST', { path: ref });
		panel.log.addEventListener('click', (event) => {
			const link = event.target.closest('.md a, .md img, .md code.path');
			if (!link) return;
			const ref = link.tagName === 'A' ? link.getAttribute('href') : link.tagName === 'IMG' ? link.dataset.path || link.src : link.textContent.trim();
			if (REMOTE.test(ref)) return link.tagName === 'IMG' && window.open(ref, '_blank', 'noopener');
			event.preventDefault();
			open(ref);
		});
	}
	const modelName = (id) => (id || '').replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1').replace(/^\w/, (c) => c.toUpperCase());

	function send(panel, message) {
		if (panel.socket?.readyState === WebSocket.OPEN) panel.socket.send(JSON.stringify(message));
	}

	// ---- rendering ----

	const nearBottom = (log) => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
	function append(panel, el) {
		const stick = nearBottom(panel.log);
		panel.log.insertBefore(el, panel.typing);
		if (stick) panel.log.scrollTop = panel.log.scrollHeight;
	}

	// A path relative to the project folder.
	const short = (panel, file) => (file || '').replace(panel.dir + '/', '');

	function describe(panel, name, input) {
		const i = input || {};
		const label = {
			Read: () => short(panel, i.file_path), Write: () => short(panel, i.file_path), Edit: () => short(panel, i.file_path),
			Bash: () => i.description || i.command, Grep: () => i.pattern, Glob: () => i.pattern,
			WebFetch: () => i.url, WebSearch: () => i.query, Task: () => i.description, Agent: () => i.description, Skill: () => i.skill,
		}[name]?.();
		return label || '';
	}

	function diff(input) {
		const pre = h('pre');
		const lines = (text, sign, cls) => (text || '').split('\n').forEach((line) => pre.append(h('span', cls, `${sign} ${line}\n`)));
		if (input.old_string != null) lines(input.old_string, '−', 'd');
		lines(input.new_string ?? input.content, '+', 'a');
		return pre;
	}

	function tool(panel, { id, name, input }) {
		if (name === 'AskUserQuestion') return; // shown as its own card
		if (name === 'TodoWrite') {
			const box = h('div', 'todos');
			for (const todo of input.todos || []) box.append(h('div', todo.status, `${{ completed: '☑', in_progress: '◐' }[todo.status] || '☐'} ${todo.content}`));
			return append(panel, box);
		}
		const row = h('details', 'tool');
		const summary = h('summary');
		const state = h('span', 'state');
		const label = describe(panel, name, input);
		summary.append(state, h('b', '', name));
		if (label) summary.append(h('code', '', label));
		if (name === 'Edit' || name === 'Write') {
			const added = (input.new_string ?? input.content ?? '').split('\n').length;
			const removed = input.old_string != null ? input.old_string.split('\n').length : 0;
			const count = h('span', 'n');
			count.append(h('span', 'a', `+${added}`), removed ? h('span', 'd', ` −${removed}`) : '');
			summary.append(count);
			row.append(summary, diff(input));
		} else {
			row.append(summary);
			if (name === 'Bash' && input.command) row.append(h('pre', 'cmd', `$ ${input.command}`));
		}
		panel.tools[id] = row;
		append(panel, row);
	}

	function result(panel, { id, error, text }) {
		const row = panel.tools[id];
		if (!row) return;
		row.classList.add(error ? 'failed' : 'ok');
		if (text && !['Edit', 'Write'].includes(row.querySelector('b').textContent)) row.append(h('pre', 'out', text));
	}

	function ask(panel, { id, name, input, title }) {
		const card = h('div', 'ask');
		card.dataset.ask = id;
		const answer = (choice, answers) => send(panel, { type: 'answer', id, choice, answers });
		if (name === 'AskUserQuestion') {
			const answers = {};
			const questions = input.questions || [];
			const submit = h('button', 'btn primary', 'Répondre');
			const ready = () => (submit.disabled = questions.some((q) => !answers[q.question]));
			for (const q of questions) {
				card.append(h('div', 'q', q.question));
				const row = h('div', 'options');
				for (const option of q.options) {
					const button = h('button', 'btn option', option.label);
					button.title = option.description || '';
					button.onclick = () => {
						if (q.multiSelect) button.classList.toggle('on');
						else row.querySelectorAll('.btn').forEach((b) => b.classList.toggle('on', b === button));
						answers[q.question] = [...row.querySelectorAll('.btn.on')].map((b) => b.textContent).join(', ');
						if (questions.length === 1 && !q.multiSelect) return answer('allow', answers);
						ready();
					};
					row.append(button);
				}
				card.append(row);
			}
			const row = h('div', 'row');
			if (questions.length > 1 || questions.some((q) => q.multiSelect)) row.append(submit);
			const other = h('button', 'btn', 'Ignorer');
			other.onclick = () => answer('deny');
			row.append(other);
			card.append(row);
			ready();
			submit.onclick = () => answer('allow', answers);
		} else {
			card.append(h('div', 'q', title || `Claude veut utiliser ${name}`));
			const detail = input.command || input.file_path || input.url;
			if (detail) card.append(h('pre', '', detail));
			if (name === 'Edit' || name === 'Write') card.append(diff(input));
			if (name === 'ExitPlanMode' && input.plan) card.querySelector('.q').insertAdjacentHTML('afterend', `<div class="md">${markdown(input.plan, panel.port)}</div>`);
			const row = h('div', 'row');
			for (const [choice, text] of [['allow', 'Autoriser'], ['always', 'Toujours autoriser'], ['deny', 'Refuser']]) {
				const button = h('button', choice === 'allow' ? 'btn primary' : 'btn', text);
				button.onclick = () => answer(choice);
				row.append(button);
			}
			card.append(row);
		}
		append(panel, card);
	}

	function setDraft(panel, text) {
		if (!text) return panel.draft?.remove(), (panel.draft = null);
		if (!panel.draft) append(panel, (panel.draft = h('div', 'ai md')));
		panel.draftText = text;
		if (panel.drawing) return;
		panel.drawing = requestAnimationFrame(() => {
			panel.drawing = null;
			if (!panel.draft) return;
			const stick = nearBottom(panel.log);
			panel.draft.innerHTML = markdown(panel.draftText, panel.port);
			if (stick) panel.log.scrollTop = panel.log.scrollHeight;
		});
	}

	function setBusy(panel, value) {
		panel.busy = value;
		panel.typing.hidden = !value;
		panel.el.classList.toggle('busy', value);
		if (!value) setDraft(panel, '');
		sendState(panel);
	}

	function sendState(panel) {
		const stop = panel.busy && !panel.input.value.trim();
		panel.sendButton.classList.toggle('stop', stop);
		panel.sendButton.innerHTML = stop ? ICONS.stop : ICONS.send;
		panel.sendButton.classList.toggle('idle', !stop && !panel.input.value.trim());
		panel.sendButton.title = stop ? 'Arrêter (Esc)' : 'Envoyer (↵)';
	}

	function info(panel, { model, mode }) {
		panel.mode = mode;
		panel.modelChip.textContent = modelName(model) || '…';
		panel.modelChip.hidden = !model;
		panel.modeChip.dataset.mode = mode;
		panel.modeChip.innerHTML = `${ICONS[mode] || ''}<span></span>`;
		panel.modeChip.lastChild.textContent = SHORT[mode] || mode || '…';
		panel.modeChip.title = `${MODES[mode] || mode} (cliquer pour changer)`;
	}

	function render(panel, event) {
		switch (event.type) {
			case 'user': return append(panel, h('div', 'me', event.text));
			case 'text': {
				setDraft(panel, '');
				const el = h('div', 'ai md');
				el.innerHTML = markdown(event.text, panel.port);
				return append(panel, el);
			}
			case 'delta': return setDraft(panel, (panel.draft ? panel.draftText : '') + event.text);
			case 'tool': return tool(panel, event);
			case 'result': return result(panel, event);
			case 'ask': return ask(panel, event);
			case 'answered': return panel.log.querySelector(`[data-ask="${event.id}"]`)?.remove();
			case 'error': return append(panel, h('div', 'error', event.text));
			case 'busy': return setBusy(panel, event.value);
			case 'info': return info(panel, event);
			case 'reset': {
				panel.log.replaceChildren(panel.typing);
				panel.tools = {};
				panel.draft = null;
				const answered = new Set(event.events.filter((e) => e.type === 'answered').map((e) => e.id));
				for (const e of event.events) if (!(e.type === 'ask' && answered.has(e.id)) && e.type !== 'answered') render(panel, e);
				if (!event.events.length) panel.log.prepend(h('div', 'empty', `Claude Code dans ${panel.place}. Demande-lui ce que tu veux.`));
				setBusy(panel, event.busy);
				if (event.draft) setDraft(panel, event.draft);
				info(panel, event);
				panel.log.scrollTop = panel.log.scrollHeight;
			}
		}
	}

	// ---- panel ----

	function connect(port) {
		const panel = panels[port];
		if (!panel) return;
		const socket = new WebSocket(`ws://${location.host}/claude/${port}`);
		panel.socket = socket;
		socket.onmessage = (event) => render(panel, JSON.parse(event.data));
		socket.onclose = (event) => {
			if (panel.socket !== socket || panels[port] !== panel) return;
			panel.socket = null;
			if (event.code !== 4000) setTimeout(() => connect(port), 1500); // server restarting
		};
	}

	function create(port) {
		const project = projects.find((p) => String(p.port) === port);
		const el = document.createElement('aside');
		el.className = 'claude';
		el.innerHTML = `
			<div class="grip" title="Glisser pour élargir"></div>
			<header><span class="spark">✻</span><b>Claude</b><span class="where"></span>
				<button data-act="history" title="Conversations précédentes"><svg viewBox="0 0 16 16"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.8v2.4h2.4M8 5v3.2l2.2 1.4"/></svg></button>
				<button data-act="new" title="Nouvelle conversation"><svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>
				<button data-act="terminal" title="Ouvrir cette conversation dans Terminal">↗</button>
				<button data-act="hide" title="Masquer (Ctrl+\`), Claude continue">×</button></header>
			<div class="history" hidden></div>
			<div class="log"><div class="typing" hidden><span class="spark">✻</span><span>Claude travaille…</span></div></div>
			<form class="composer">
				<textarea rows="1" placeholder="Écris à Claude… (↵ envoyer, ⇧↵ nouvelle ligne)"></textarea>
				<div class="bar"><span class="chip model" hidden></span><button type="button" class="chip mode" title="Mode d’autorisation (cliquer pour changer)"></button><button class="send idle"></button></div>
			</form>`;
		el.querySelector('.where').textContent = `· ${project?.place || ''}`;
		frames[port].append(el);

		const panel = (panels[port] = {
			el, port, dir: project?.dir || '', place: project?.place || '', tools: {}, busy: false,
			log: el.querySelector('.log'), typing: el.querySelector('.typing'), input: el.querySelector('textarea'),
			sendButton: el.querySelector('.send'), modelChip: el.querySelector('.model'), modeChip: el.querySelector('.mode'),
		});
		openLinks(panel);
		const { input } = panel;
		const grow = () => {
			input.style.height = 'auto';
			input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
			sendState(panel);
		};
		input.oninput = grow;
		input.onkeydown = (event) => {
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				el.querySelector('form').requestSubmit();
			}
			if (event.key === 'Escape' && panel.busy) send(panel, { type: 'stop' });
		};
		el.querySelector('form').onsubmit = (event) => {
			event.preventDefault();
			const text = input.value.trim();
			if (!text) return panel.busy && send(panel, { type: 'stop' });
			send(panel, { type: 'send', text });
			input.value = '';
			grow();
		};
		panel.modeChip.onclick = () => send(panel, { type: 'mode', mode: CYCLE[(CYCLE.indexOf(panel.mode) + 1) % CYCLE.length] });

		el.querySelector('[data-act=terminal]').onclick = () => api(`projects/${port}/terminal`, 'POST');
		el.querySelector('[data-act=hide]').onclick = () => toggle(port, false);
		el.querySelector('[data-act=new]').onclick = () => {
			send(panel, { type: 'open' });
			input.focus();
		};
		el.querySelector('[data-act=history]').onclick = () => history(panel);
		resizable(el.querySelector('.grip'));
		connect(port);
	}

	async function history(panel) {
		const box = panel.el.querySelector('.history');
		if (!box.hidden) return (box.hidden = true);
		box.replaceChildren(h('div', 'none', '…'));
		box.hidden = false;
		const list = await api(`projects/${panel.port}/sessions`);
		box.replaceChildren(...(list.length ? [] : [h('div', 'none', 'Aucune conversation.')]));
		for (const s of list) {
			const item = h('button', 'item');
			item.append(h('span', 'title', s.title), h('span', 'when', new Date(s.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
			item.onclick = () => {
				box.hidden = true;
				send(panel, { type: 'open', sessionId: s.id });
			};
			box.append(item);
		}
	}

	function resizable(grip) {
		grip.onpointerdown = (event) => {
			grip.setPointerCapture(event.pointerId);
			document.body.classList.add('resizing');
			const right = grip.parentElement.parentElement.getBoundingClientRect().right;
			grip.onpointermove = (move) => {
				const px = Math.round(Math.min(Math.max(right - move.clientX, 320), window.innerWidth - 360));
				setWidth(px);
				store('claudeWidth', px);
			};
			grip.onpointerup = () => {
				grip.onpointermove = null;
				document.body.classList.remove('resizing');
			};
		};
	}

	// Shows or hides the panel of a board (force: true or false), connecting on first show.
	function toggle(port, force) {
		if (!port || !frames[port]) return;
		const show = force ?? !visible(port);
		if (show && !panels[port]) create(port);
		if (panels[port]) panels[port].el.hidden = !show;
		show ? shown.add(port) : shown.delete(port);
		store('claude', [...shown]);
		if (show) requestAnimationFrame(() => panels[port].input.focus());
		highlight();
	}

	const visible = (port) => Boolean(panels[port] && !panels[port].el.hidden);

	// The board's tab is closed: Claude stops (the conversation is kept and reopened next time).
	function stop(port) {
		const panel = panels[port];
		if (panel) {
			delete panels[port];
			panel.socket?.close();
		}
		api(`projects/${port}/claude`, 'DELETE');
		shown.delete(port);
		store('claude', [...shown]);
	}

	return { toggle, visible, stop, wasShown: (port) => shown.has(port) };
})();
