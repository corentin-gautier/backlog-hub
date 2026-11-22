// Claude beside each board: a chat with the project's Claude Code conversation, run on the server
// (claude.js) and streamed over a WebSocket as simple events. Uses `frames`, `projects`, `api`,
// `stored` and `store` from app.js, `marked` and `DOMPurify` from vendor/.
const Claude = (() => {
	const panels = {}; // port -> { el, log, socket, tools, draft, busy, mode }
	const shown = new Set(stored('claude', [])); // ports whose panel is open
	const MODES = { default: 'Ask before acting', acceptEdits: 'Accept edits', plan: 'Plan', auto: 'Auto' };
	const SHORT = { default: 'Ask', acceptEdits: 'Edit', plan: 'Plan', auto: 'Auto' };
	const icon = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
	const ICONS = {
		default: icon('M8 2.2 12.8 4v3.6c0 2.9-2 5-4.8 6.2C5.2 12.6 3.2 10.5 3.2 7.6V4Z'),
		acceptEdits: icon('M10.2 3.3l2.5 2.5-6.9 6.9H3.3v-2.5Z'),
		plan: icon('M3 4.5h10M3 8h10M3 11.5h6'),
		auto: icon('M9 1.8 3.8 9h4.1l-.9 5.2L12.2 7H8.1Z'),
		send: icon('M8 12.5v-9M4 7.5l4-4 4 4'),
		stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5"/></svg>',
	};
	const ORDER = ['default', 'acceptEdits', 'plan', 'auto'];
	const HINTS = { default: 'Claude asks before each edit or command', acceptEdits: 'Edits files without asking', plan: 'Explores and proposes a plan, changes nothing', auto: 'Acts alone, asks only for risky actions' };

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

	// Clicks in the chat, all opened by the server so the app never navigates away: web links in the default browser, files open on the Mac (code in VS Code at its line).
	function openLinks(panel) {
		const open = (ref) => api(`projects/${panel.port}/open`, 'POST', { path: ref });
		panel.log.addEventListener('click', (event) => {
			const link = event.target.closest('.md a, .md img, .md code.path');
			if (!link) return;
			const ref = link.tagName === 'A' ? link.getAttribute('href') : link.tagName === 'IMG' ? link.dataset.path || link.src : link.textContent.trim();
			event.preventDefault();
			if (/^(data|blob):/i.test(ref)) return;
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
			const submit = h('button', 'btn primary', 'Answer');
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
			const other = h('button', 'btn', 'Skip');
			other.onclick = () => answer('deny');
			row.append(other);
			card.append(row);
			ready();
			submit.onclick = () => answer('allow', answers);
		} else {
			card.append(h('div', 'q', title || `Claude wants to use ${name}`));
			const detail = input.command || input.file_path || input.url;
			if (detail) card.append(h('pre', '', detail));
			if (name === 'Edit' || name === 'Write') card.append(diff(input));
			if (name === 'ExitPlanMode' && input.plan) card.querySelector('.q').insertAdjacentHTML('afterend', `<div class="md">${markdown(input.plan, panel.port)}</div>`);
			const row = h('div', 'row');
			for (const [choice, text] of [['allow', 'Allow'], ['always', 'Always allow'], ['deny', 'Deny']]) {
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
		const empty = !panel.input.value.trim() && !panel.images.length;
		const stop = panel.busy && empty;
		panel.sendButton.classList.toggle('stop', stop);
		panel.sendButton.innerHTML = stop ? ICONS.stop : ICONS.send;
		panel.sendButton.classList.toggle('idle', !stop && empty);
		panel.sendButton.title = stop ? 'Stop (Esc)' : 'Send (↵)';
	}

	function info(panel, { model, choice, mode, models }) {
		panel.mode = mode;
		panel.choice = choice || 'default';
		if (models?.length) panel.models = models;
		const chosen = choice && panel.models.find((m) => m.value === choice);
		panel.modelChip.innerHTML = '<span></span><i class="caret"></i>';
		panel.modelChip.firstChild.textContent = chosen?.name || modelName(model) || 'Model';
		panel.modelChip.hidden = !model && !panel.models.length;
		panel.modeChip.dataset.mode = mode;
		panel.modeChip.innerHTML = `${ICONS[mode] || ''}<span></span><i class="caret"></i>`;
		panel.modeChip.children[1].textContent = SHORT[mode] || mode || '…';
		panel.modeChip.title = MODES[mode] || mode || '';
	}

	// A menu over the composer (the model or the mode); one open at a time, closed by a pick, a click elsewhere or Esc.
	function menu(panel, chip, items, current, pick) {
		const open = panel.menu;
		closeMenu(panel);
		if (open?.chip === chip) return;
		const box = h('div', 'pick');
		box.classList.toggle('right', chip === panel.modelChip);
		for (const item of items) {
			const row = h('button', item.value === current ? 'opt on' : 'opt');
			row.type = 'button';
			if (item.mode) row.dataset.mode = item.mode;
			row.innerHTML = item.icon || '';
			const text = h('span', 'text');
			text.append(h('b', '', item.label), item.hint ? h('span', 'hint', item.hint) : '');
			row.append(text, h('span', 'check', item.value === current ? '✓' : ''));
			row.onclick = () => (closeMenu(panel), pick(item.value));
			box.append(row);
		}
		chip.after(box);
		chip.classList.add('open');
		// No higher than the space between the panel's header and the composer.
		box.style.maxHeight = `${Math.min(340, panel.el.querySelector('.composer').getBoundingClientRect().top - panel.log.getBoundingClientRect().top - 10)}px`;
		box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
		const outside = (event) => !box.contains(event.target) && !chip.contains(event.target) && closeMenu(panel);
		const key = (event) => event.key === 'Escape' && (event.stopPropagation(), closeMenu(panel));
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('keydown', key, true);
		panel.menu = { chip, box, off: () => (document.removeEventListener('pointerdown', outside, true), document.removeEventListener('keydown', key, true)) };
	}

	function closeMenu(panel) {
		if (!panel.menu) return;
		panel.menu.off();
		panel.menu.box.remove();
		panel.menu.chip.classList.remove('open');
		panel.menu = null;
	}

	function render(panel, event) {
		switch (event.type) {
			case 'user': {
				const el = h('div', 'me', event.text);
				if (event.images?.length) {
					const row = h('div', 'shots');
					for (const src of event.images) row.append(Object.assign(h('img'), { src }));
					el.prepend(row);
				}
				return append(panel, el);
			}
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
			case 'commands': return setCommands(panel, event.list);
			case 'reset': {
				panel.log.replaceChildren(panel.typing);
				panel.tools = {};
				panel.draft = null;
				const answered = new Set(event.events.filter((e) => e.type === 'answered').map((e) => e.id));
				for (const e of event.events) if (!(e.type === 'ask' && answered.has(e.id)) && e.type !== 'answered') render(panel, e);
				if (!event.events.length) panel.log.prepend(h('div', 'empty', panel.port === 'home' ? 'A question, an idea, a task outside any project? Ask Claude.' : `Claude Code in ${panel.place}. Ask it anything.`));
				setBusy(panel, event.busy);
				if (event.draft) setDraft(panel, event.draft);
				info(panel, event);
				setCommands(panel, event.commands || []);
				panel.log.scrollTop = panel.log.scrollHeight;
			}
		}
	}

	// ---- images ----
	// Dropped on the panel or pasted in the composer, shown above the input (× removes one), sent with the message.

	const MAX_SIDE = 1568; // larger images are scaled down (Claude would anyway), keeping the message small
	function readImage(file) {
		return new Promise((resolve) => {
			const url = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
				const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
				canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
				URL.revokeObjectURL(url);
				resolve(file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png'));
			};
			img.onerror = () => (URL.revokeObjectURL(url), resolve(null));
			img.src = url;
		});
	}

	function setImages(panel, images) {
		panel.images = images;
		panel.shots.hidden = !images.length;
		panel.shots.replaceChildren(...images.map((src, i) => {
			const item = h('span', 'shot');
			const remove = h('button', '', '×');
			remove.type = 'button';
			remove.title = 'Remove';
			remove.onclick = () => setImages(panel, panel.images.filter((_, j) => j !== i));
			item.append(Object.assign(h('img'), { src }), remove);
			return item;
		}));
		sendState(panel);
	}

	async function addImages(panel, files) {
		const images = (await Promise.all([...files].filter((f) => f.type.startsWith('image/')).map(readImage))).filter(Boolean);
		if (images.length) setImages(panel, [...panel.images, ...images]), panel.input.focus();
	}

	function dropImages(panel) {
		const { el } = panel;
		const files = (event) => [...(event.dataTransfer?.items || [])].some((i) => i.kind === 'file');
		let depth = 0;
		el.addEventListener('dragenter', (event) => files(event) && (depth++, el.classList.add('dropping')));
		el.addEventListener('dragleave', () => depth && !--depth && el.classList.remove('dropping'));
		el.addEventListener('dragover', (event) => files(event) && event.preventDefault());
		el.addEventListener('drop', (event) => {
			if (!files(event)) return;
			event.preventDefault();
			depth = 0;
			el.classList.remove('dropping');
			addImages(panel, event.dataTransfer.files);
		});
		panel.input.addEventListener('paste', (event) => {
			const images = [...event.clipboardData.files].filter((f) => f.type.startsWith('image/'));
			if (!images.length) return;
			event.preventDefault();
			addImages(panel, images);
		});
	}

	// ---- slash commands ----

	// Handled by the page: a new conversation and the history.
	const LOCAL = {
		clear: { description: 'New conversation', run: (panel) => send(panel, { type: 'open' }) },
		resume: { description: 'Resume an earlier conversation', run: (panel) => history(panel) },
	};

	function setCommands(panel, list) {
		const local = Object.entries(LOCAL).map(([name, c]) => ({ name, description: c.description, hint: '' }));
		panel.commands = [...local, ...list.filter((c) => !LOCAL[c.name])];
		slashMenu(panel);
	}

	// The menu over the composer while the message is a lone "/word".
	function slashMenu(panel) {
		const query = (panel.input.value.match(/^\/(\S*)$/) || [])[1];
		const box = panel.slash;
		if (query == null) return (box.hidden = true, (panel.matches = []));
		const q = query.toLowerCase();
		const starts = panel.commands.filter((c) => c.name.toLowerCase().startsWith(q));
		const has = panel.commands.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(q));
		panel.matches = [...starts, ...has];
		panel.pick = Math.min(panel.pick || 0, Math.max(panel.matches.length - 1, 0));
		box.hidden = !panel.matches.length;
		box.replaceChildren(...panel.matches.map((c, i) => {
			const row = h('div', i === panel.pick ? 'cmd on' : 'cmd');
			row.append(h('b', '', `/${c.name}`), c.hint ? h('span', 'hint', c.hint) : '', h('span', 'desc', c.description));
			row.onmousedown = (event) => {
				event.preventDefault();
				choose(panel, c, false);
			};
			return row;
		}));
		box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
	}

	// Picks a command: completes it, or sends it right away when it takes no argument (Enter).
	function choose(panel, command, run) {
		panel.input.value = `/${command.name} `;
		panel.pick = 0;
		if (run && !command.hint) return panel.el.querySelector('form').requestSubmit();
		panel.input.dispatchEvent(new Event('input'));
		panel.input.focus();
	}

	function slashKeys(panel, event) {
		if (panel.slash.hidden) return false;
		const n = panel.matches.length;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') panel.pick = (panel.pick + (event.key === 'ArrowDown' ? 1 : n - 1)) % n;
		else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') return event.preventDefault(), choose(panel, panel.matches[panel.pick], event.key === 'Enter'), true;
		else if (event.key === 'Escape') panel.slash.hidden = true;
		else return false;
		event.preventDefault();
		if (!panel.slash.hidden) slashMenu(panel);
		return true;
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

	// A panel beside a board, or the home's general chat (port 'home') in the given box.
	function create(port, box) {
		const project = box ? { dir: '', place: 'General' } : projects.find((p) => String(p.port) === port);
		const el = document.createElement('aside');
		el.className = box ? 'claude general' : 'claude';
		el.innerHTML = `
			<div class="grip" title="Drag to resize"></div>
			<header><span class="spark">✻</span><b>Claude</b><span class="where"></span>
				<button data-act="history" title="Earlier conversations"><svg viewBox="0 0 16 16"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.8v2.4h2.4M8 5v3.2l2.2 1.4"/></svg></button>
				<button data-act="new" title="New conversation"><svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>
				<button data-act="terminal" title="Open this conversation in Terminal">↗</button>
				<button data-act="hide" title="Hide (Ctrl+\`), Claude keeps going">×</button></header>
			<div class="history" hidden></div>
			<div class="log"><div class="typing" hidden><span class="spark">✻</span><span>Claude is working…</span></div></div>
			<form class="composer">
				<div class="slash" hidden></div>
				<div class="shots" hidden></div>
				<textarea rows="1" placeholder="Message Claude…  / for commands" title="↵ send, ⇧↵ new line, Esc stop"></textarea>
				<div class="bar"><button type="button" class="chip mode"></button><button type="button" class="chip model" hidden></button><button class="send idle"></button></div>
			</form>`;
		el.querySelector('.where').textContent = box ? 'General conversation' : `· ${project?.place || ''}`;
		(box || frames[port]).append(el);

		const panel = (panels[port] = {
			el, port, images: [], shots: el.querySelector('.composer .shots'), dir: project?.dir || '', place: project?.place || '', tools: {}, busy: false, commands: [], matches: [], pick: 0, models: [], choice: 'default',
			log: el.querySelector('.log'), typing: el.querySelector('.typing'), input: el.querySelector('textarea'),
			slash: el.querySelector('.slash'), sendButton: el.querySelector('.send'), modelChip: el.querySelector('.model'), modeChip: el.querySelector('.mode'),
		});
		openLinks(panel);
		dropImages(panel);
		const { input } = panel;
		const grow = () => {
			input.style.height = 'auto';
			input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
			sendState(panel);
		};
		input.oninput = () => {
			grow();
			slashMenu(panel);
		};
		input.onblur = () => (panel.slash.hidden = true);
		input.onkeydown = (event) => {
			if (slashKeys(panel, event)) return;
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				el.querySelector('form').requestSubmit();
			}
			if (event.key === 'Escape' && panel.busy) send(panel, { type: 'stop' });
		};
		el.querySelector('form').onsubmit = (event) => {
			event.preventDefault();
			const text = input.value.trim();
			if (!text && !panel.images.length) return panel.busy && send(panel, { type: 'stop' });
			const local = !panel.images.length && LOCAL[(text.match(/^\/(\S+)$/) || [])[1]];
			if (local) local.run(panel);
			else send(panel, { type: 'send', text, images: panel.images });
			setImages(panel, []);
			input.value = '';
			grow();
			slashMenu(panel);
		};
		panel.modeChip.onclick = () => menu(panel, panel.modeChip,
			ORDER.map((mode) => ({ value: mode, mode, icon: ICONS[mode], label: MODES[mode], hint: HINTS[mode] })),
			panel.mode, (mode) => send(panel, { type: 'mode', mode }));
		panel.modelChip.onclick = () => menu(panel, panel.modelChip,
			panel.models.map((m) => ({ value: m.value, label: m.name, hint: m.description })),
			panel.choice, (model) => send(panel, { type: 'model', model }));

		el.querySelector('[data-act=terminal]').onclick = () => api(`projects/${port}/terminal`, 'POST');
		el.querySelector('[data-act=hide]').onclick = () => toggle(port, false);
		el.querySelector('[data-act=new]').onclick = () => {
			send(panel, { type: 'open' });
			input.focus();
		};
		el.querySelector('[data-act=history]').onclick = () => history(panel);
		if (box) el.querySelector('.grip').remove(), el.querySelector('[data-act=hide]').remove();
		else resizable(el.querySelector('.grip'));
		connect(port);
	}

	async function history(panel) {
		const box = panel.el.querySelector('.history');
		if (!box.hidden) return (box.hidden = true);
		box.replaceChildren(h('div', 'none', '…'));
		box.hidden = false;
		const list = await api(`projects/${panel.port}/sessions`);
		box.replaceChildren(...(list.length ? [] : [h('div', 'none', 'No conversations.')]));
		for (const s of list) {
			const item = h('button', 'item');
			item.append(h('span', 'title', s.title), h('span', 'when', new Date(s.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
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

	// The home's general chat, created once.
	const general = (box) => panels.home || create('home', box);

	return { general, toggle, visible, stop, wasShown: (port) => shown.has(port) };
})();

Claude.general($('#general'));
