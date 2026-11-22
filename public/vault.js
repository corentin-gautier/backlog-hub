// Encrypted docs (vault.js on the server): the padlock in the top bar lists the project's docs,
// a box marks a doc to keep encrypted, and one button unlocks them all with Touch ID.
// Uses `api`, `$` and `current` from app.js.
const Vault = (() => {
	const button = $('#vault');
	const menu = document.createElement('div');
	menu.id = 'vault-menu';
	menu.hidden = true;
	document.body.append(menu);
	const CLOSED = 'M4.5 7.5V5.5a3.5 3.5 0 0 1 7 0v2';
	const OPEN = 'M4.5 7.5V5.5a3.5 3.5 0 0 1 6.8-1.2';
	const icon = (shackle) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${shackle}"/><rect x="3" y="7.5" width="10" height="6.5" rx="1.5"/></svg>`;
	let state = { docs: [], until: null };
	let busy = false;

	function draw() {
		button.innerHTML = icon(state.until ? OPEN : CLOSED);
		button.classList.toggle('on', Boolean(state.until));
		button.title = state.until ? 'Documents chiffrés déverrouillés' : 'Documents chiffrés';
		const locked = state.docs.filter((d) => d.marked && d.locked).length;
		const top = document.createElement('div');
		top.className = 'top';
		if (state.error) top.append(Object.assign(document.createElement('p'), { className: 'error', textContent: state.error }));
		if (locked) top.append(action(`Déverrouiller avec Touch ID (${locked})`, 'unlock'));
		else if (state.until) {
			const minutes = Math.max(1, Math.round((state.until - Date.now()) / 60000));
			top.append(Object.assign(document.createElement('p'), { textContent: `Verrouillage automatique dans ${minutes} min.` }), action('Verrouiller maintenant', 'lock'));
		} else top.append(Object.assign(document.createElement('p'), { textContent: 'Coche un document pour le chiffrer.' }));
		const list = document.createElement('div');
		list.className = 'docs';
		for (const doc of state.docs) {
			const row = document.createElement('label');
			const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: doc.marked, disabled: busy });
			box.onchange = () => act(box.checked ? 'mark' : 'unmark', doc.file);
			const name = Object.assign(document.createElement('span'), { textContent: doc.title });
			row.append(box, name);
			if (doc.marked) row.insertAdjacentHTML('beforeend', icon(doc.locked ? CLOSED : OPEN));
			list.append(row);
		}
		menu.replaceChildren(top, list);
	}

	function action(text, what) {
		return Object.assign(document.createElement('button'), { textContent: text, disabled: busy, onclick: () => act(what) });
	}

	async function act(what, file) {
		busy = true;
		draw();
		const port = current;
		const result = await api(`projects/${port}/vault`, 'POST', { do: what, file });
		busy = false;
		if (port !== current) return;
		state = result.error ? { ...state, error: result.error === 'Authentication cancelled' ? 'Déverrouillage annulé.' : result.error } : result;
		draw();
	}

	async function refresh() {
		if (!current) return;
		const port = current;
		const result = await api(`projects/${port}/vault`);
		if (port === current && !result.error) (state = result), draw();
	}

	button.onclick = (event) => {
		event.stopPropagation();
		menu.hidden = !menu.hidden;
		if (!menu.hidden) refresh();
	};
	menu.onclick = (event) => event.stopPropagation();
	addEventListener('click', () => (menu.hidden = true));
	addEventListener('keydown', (event) => event.key === 'Escape' && (menu.hidden = true));
	// The padlock opens when the docs are unlocked, and closes again with the automatic lock.
	setInterval(refresh, 30000);

	return {
		show() {
			menu.hidden = true;
			state = { docs: [], until: null };
			draw();
			refresh();
		},
		lock: (port) => api(`projects/${port}/vault`, 'POST', { do: 'lock' }),
	};
})();
