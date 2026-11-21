// Claude Code beside each board: a terminal running `claude` in the project folder,
// streamed from the server (claude.js) over a WebSocket. Uses `frames`, `api`, `stored`
// and `store` from app.js.
const Claude = (() => {
	const panels = {}; // port -> { el, term, fit, socket }
	const shown = new Set(stored('claude', [])); // ports whose panel is open
	const THEME = { background: '#030712', foreground: '#e5e7eb', cursor: '#e5e7eb', selectionBackground: '#374151' };

	const setWidth = (px) => document.body.style.setProperty('--claude-width', `${px}px`);
	setWidth(stored('claudeWidth', 520));

	function send(panel, message) {
		if (panel.socket?.readyState === WebSocket.OPEN) panel.socket.send(JSON.stringify(message));
	}

	function connect(port) {
		const panel = panels[port];
		const { term } = panel;
		const socket = new WebSocket(`ws://${location.host}/claude/${port}?cols=${term.cols}&rows=${term.rows}`);
		panel.socket = socket;
		socket.onmessage = (event) => term.write(event.data);
		socket.onclose = () => {
			if (panel.socket !== socket) return;
			panel.socket = null;
			term.write('\r\n\x1b[2m[Claude Code arrêté : ↻ pour le relancer]\x1b[0m\r\n');
		};
	}

	function create(port) {
		const project = projects.find((p) => String(p.port) === port);
		const el = document.createElement('aside');
		el.className = 'claude';
		el.innerHTML = `
			<div class="grip" title="Glisser pour élargir"></div>
			<header><span class="spark">✻</span><b>Claude Code</b><span class="where"></span>
				<button data-act="terminal" title="Ouvrir dans Terminal">↗ Terminal</button>
				<button data-act="restart" title="Relancer Claude Code">↻</button>
				<button data-act="hide" title="Masquer (Ctrl+\`), Claude continue">×</button></header>
			<div class="term"></div>`;
		el.querySelector('.where').textContent = `· ${project?.place || ''}`;
		frames[port].append(el);

		const term = new Terminal({ theme: THEME, fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12.5, lineHeight: 1.2, cursorBlink: true, allowProposedApi: true });
		const fit = new FitAddon.FitAddon();
		term.loadAddon(fit);
		term.open(el.querySelector('.term'));
		term.attachCustomKeyEventHandler((event) => !(event.ctrlKey && event.key === '`'));
		panels[port] = { el, term, fit, socket: null };
		term.onData((data) => send(panels[port], { type: 'input', data }));
		term.onResize(({ cols, rows }) => send(panels[port], { type: 'resize', cols, rows }));
		new ResizeObserver(() => el.offsetWidth && fit.fit()).observe(el.querySelector('.term'));
		fit.fit();
		connect(port);

		el.querySelector('[data-act=terminal]').onclick = () => api(`projects/${port}/terminal`, 'POST');
		el.querySelector('[data-act=hide]').onclick = () => toggle(port, false);
		el.querySelector('[data-act=restart]').onclick = async () => {
			panels[port].socket = null;
			await api(`projects/${port}/claude`, 'DELETE');
			term.reset();
			connect(port);
			term.focus();
		};
		resizable(el.querySelector('.grip'));
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

	// Shows or hides the panel of a board (force: true or false), starting Claude on first show.
	function toggle(port, force) {
		if (!port || !frames[port]) return;
		const show = force ?? !visible(port);
		if (show && !panels[port]) create(port);
		if (panels[port]) panels[port].el.hidden = !show;
		show ? shown.add(port) : shown.delete(port);
		store('claude', [...shown]);
		if (show) requestAnimationFrame(() => {
			panels[port].fit.fit();
			panels[port].term.focus();
		});
		highlight();
	}

	const visible = (port) => Boolean(panels[port] && !panels[port].el.hidden);

	// The board's tab is closed: Claude stops.
	function stop(port) {
		const panel = panels[port];
		if (panel) {
			panel.socket = null;
			panel.term.dispose();
			delete panels[port];
		}
		api(`projects/${port}/claude`, 'DELETE');
		shown.delete(port);
		store('claude', [...shown]);
	}

	return { toggle, visible, stop, wasShown: (port) => shown.has(port) };
})();
