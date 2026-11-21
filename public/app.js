// One tab per open project; each board loads in its own pane (an iframe, and Claude Code beside it),
// kept so it stays where it was left.
const frames = {};
let projects = [];
let categories = [];
let current = '';

const $ = (selector) => document.querySelector(selector);
const api = (url, method = 'GET', body) =>
	fetch(`/api/${url}`, { method, body: body && JSON.stringify(body), headers: body && { 'Content-Type': 'application/json' } }).then((res) => res.json());

function take(state) {
	categories = state.categories;
	projects = state.projects;
}

// Stored per browser: the open tabs and the one shown.
function stored(key, fallback) {
	try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}

function store(key, value) {
	try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

let open = stored('open', []);

function render() {
	open = open.filter((port) => projects.some((p) => String(p.port) === port));
	store('open', open);
	$('#tabs').replaceChildren($('#tabs [data-home]'), ...open.map((port) => tab(projects.find((p) => String(p.port) === port))));
	const known = (p) => categories.includes(p.category);
	$('#groups').replaceChildren(
		...categories.map((name) => group(name, projects.filter((p) => p.category === name))),
		group('', projects.filter((p) => !known(p)))
	);
	highlight();
}

// A section of cards; '' is the uncategorized one, last, holding the add card.
function group(name, list) {
	const el = document.createElement('section');
	el.className = 'group';
	el.dataset.cat = name;
	el.innerHTML = `<h2><span class="cat"></span><span class="count"></span></h2><div class="cards"></div>`;
	el.querySelector('.cat').textContent = name || 'Sans catégorie';
	el.querySelector('.count').textContent = list.length;
	el.querySelector('.cards').append(...list.map(card));
	if (!name) {
		el.querySelector('h2').classList.add('none');
		el.querySelector('.cards').append(newCard());
		return el;
	}
	const head = el.querySelector('h2');
	draggable(head, 'group');
	head.title = 'Glisser pour déplacer la catégorie';
	const actions = document.createElement('span');
	actions.className = 'acts';
	actions.innerHTML = '<button>Renommer</button><button>Supprimer</button>';
	actions.children[0].onclick = () => rename(el);
	actions.children[1].onclick = () => {
		categories = categories.filter((c) => c !== name);
		persist();
	};
	head.append(actions);
	return el;
}

function rename(el, fresh) {
	const label = el.querySelector('.cat');
	const before = el.dataset.cat;
	el.querySelector('h2').draggable = false;
	label.contentEditable = 'plaintext-only';
	label.focus();
	getSelection().selectAllChildren(label);
	label.onkeydown = (event) => {
		if (event.key === 'Enter') label.blur();
		if (event.key === 'Escape') {
			label.textContent = before;
			label.blur();
		}
	};
	label.onblur = () => {
		const name = label.textContent.trim();
		if (!name || name === before || categories.includes(name)) return fresh ? persist() : render();
		categories = categories.map((c) => (c === before ? name : c));
		projects.forEach((p) => p.category === before && (p.category = name));
		persist();
	};
}

function newCategory() {
	let name = 'Nouvelle catégorie';
	for (let i = 2; categories.includes(name); i++) name = `Nouvelle catégorie ${i}`;
	categories.push(name);
	render();
	rename($(`.group[data-cat="${CSS.escape(name)}"]`), true);
}

// Saves the categories and the projects' order and categories, then redraws.
async function persist() {
	const order = projects.map((p) => ({ port: p.port, category: categories.includes(p.category) ? p.category : null }));
	render();
	take(await api('layout', 'PUT', { categories, order }));
	render();
}

// ---- drag and drop: cards between and within sections, sections, tabs ----

let dragged = null; // the element being moved: a card, a section or a tab

function draggable(el, kind) {
	el.draggable = true;
	el.addEventListener('dragstart', (event) => {
		event.stopPropagation();
		dragged = kind === 'group' ? el.closest('.group') : el;
		dragged.dataset.kind = kind;
		event.dataTransfer.effectAllowed = 'move';
		if (kind === 'group') event.dataTransfer.setDragImage(el, 20, 12);
		requestAnimationFrame(() => dragged?.classList.add('dragging'));
	});
	el.addEventListener('dragend', () => {
		if (!dragged) return;
		const kind = dragged.dataset.kind;
		dragged.classList.remove('dragging');
		document.querySelectorAll('.target').forEach((t) => t.classList.remove('target'));
		dragged = null;
		if (kind === 'tab') {
			open = [...document.querySelectorAll('#tabs [data-port]')].map((t) => t.dataset.port);
			store('open', open);
		} else {
			readLayout();
		}
	});
}

// Moves the dragged element next to the item under the pointer.
function place(event, item, vertical) {
	if (!item || item === dragged) return;
	const box = item.getBoundingClientRect();
	const after = vertical ? event.clientY > box.top + box.height / 2 : event.clientX > box.left + box.width / 2;
	if (after ? item.nextElementSibling !== dragged : item.previousElementSibling !== dragged) item[after ? 'after' : 'before'](dragged);
}

function over(event) {
	if (!dragged) return;
	const kind = dragged.dataset.kind;
	if (kind === 'card') {
		const cards = event.target.closest('.cards') || event.target.closest('.group')?.querySelector('.cards');
		if (!cards) return;
		event.preventDefault();
		const item = event.target.closest('.card:not(.new)');
		if (item && cards.contains(item)) place(event, item);
		else if (dragged.parentElement !== cards) cards.insertBefore(dragged, cards.querySelector('.new'));
		document.querySelectorAll('.target').forEach((t) => t !== cards.parentElement && t.classList.remove('target'));
		cards.parentElement.classList.add('target');
	} else if (kind === 'group') {
		event.preventDefault();
		const item = event.target.closest('.group');
		if (item && item.dataset.cat) place(event, item, true);
	} else if (kind === 'tab') {
		const item = event.target.closest('#tabs [data-port]');
		if (!event.target.closest('#tabs')) return;
		event.preventDefault();
		place(event, item);
	}
}

// Reads the new order back from the page.
function readLayout() {
	const groups = [...document.querySelectorAll('.group')];
	categories = groups.map((g) => g.dataset.cat).filter(Boolean);
	const byPort = Object.fromEntries(projects.map((p) => [p.port, p]));
	projects = groups.flatMap((g) => [...g.querySelectorAll('.card[data-port]')].map((c) => ({ ...byPort[c.dataset.port], category: g.dataset.cat || null })));
	persist();
}

document.addEventListener('dragover', over);
document.addEventListener('drop', (event) => dragged && event.preventDefault());

function tab(p) {
	const el = document.createElement('button');
	el.dataset.port = p.port;
	el.onclick = () => show(String(p.port));
	const dot = document.createElement('span');
	dot.className = 'dot';
	dot.textContent = p.name[0].toUpperCase();
	dot.style.background = colour(p.name);
	const close = document.createElement('span');
	close.className = 'close';
	close.title = 'Fermer';
	close.textContent = '×';
	close.onclick = (event) => {
		event.stopPropagation();
		closeTab(String(p.port));
	};
	// Middle click closes the tab, as in a browser (mousedown is cancelled to skip autoscroll).
	el.onmousedown = (event) => event.button === 1 && event.preventDefault();
	el.onauxclick = (event) => event.button === 1 && closeTab(String(p.port));
	el.append(dot, p.name, close);
	draggable(el, 'tab');
	return el;
}

function closeTab(port) {
	const index = open.indexOf(port);
	open.splice(index, 1);
	Claude.stop(port);
	frames[port]?.remove();
	delete frames[port];
	if (current === port) show(open[Math.min(index, open.length - 1)] || '');
	render();
}

// A colour per project, picked from its name so it stays the same.
const COLOURS = ['#a8619e', '#4f9db0', '#c8743f', '#7a6fc4', '#4f6fc4', '#c45a5a', '#c4a23a', '#6b7a8f'];
function colour(name) {
	let hash = 0;
	for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
	return COLOURS[hash % COLOURS.length];
}

function card(p) {
	const total = p.todo + p.doing + p.done || 1;
	const el = document.createElement('div');
	el.className = 'card';
	el.dataset.port = p.port;
	el.innerHTML = `
		<div class="top"><div class="avatar"></div><div style="min-width:0"><div class="name"></div><div class="place"></div></div></div>
		<div class="progress"><i style="width:${(p.done / total) * 100}%;background:var(--done)"></i><i style="width:${(p.doing / total) * 100}%;background:var(--doing)"></i></div>
		<div class="stats"><span><b>${p.done}</b> faites</span><span><b>${p.doing}</b> en cours</span><span><b>${p.todo}</b> à faire</span></div>
		<button class="code" title="Ouvrir dans VS Code"><svg viewBox="0 0 16 16"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg></button>
		<button class="remove" title="Retirer de la liste (le dossier reste)">×</button>`;
	el.querySelector('.avatar').textContent = p.name[0].toUpperCase();
	el.querySelector('.avatar').style.background = colour(p.name);
	el.querySelector('.name').textContent = p.name;
	el.querySelector('.place').textContent = p.place;
	el.onclick = () => show(String(p.port));
	el.querySelector('.code').onclick = (event) => {
		event.stopPropagation();
		api(`projects/${p.port}/code`, 'POST');
	};
	el.querySelector('.remove').onclick = async (event) => {
		event.stopPropagation();
		if (!confirm(`Retirer « ${p.name} » de la liste ? Le dossier et ses tâches restent.`)) return;
		if (open.includes(String(p.port))) closeTab(String(p.port));
		take(await api(`projects/${p.port}`, 'DELETE'));
		render();
	};
	draggable(el, 'card');
	return el;
}

function newCard() {
	const el = document.createElement('button');
	el.className = 'card new';
	el.textContent = '+ Ajouter un projet';
	el.onclick = add;
	return el;
}

function highlight() {
	document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', (b.dataset.port || '') === current));
	$('#home').classList.toggle('on', !current);
	Object.entries(frames).forEach(([port, pane]) => pane.classList.toggle('on', port === current));
	$('#claude').hidden = !current;
	$('#code').hidden = !current;
	$('#claude').classList.toggle('on', Claude.visible(current));
}

async function show(port) {
	current = port;
	store('tab', port);
	if (port && !open.includes(port)) {
		open.push(port);
		render();
	}
	highlight();
	if (!port) return refresh();
	if (!frames[port]) {
		const pane = document.createElement('div');
		const frame = document.createElement('iframe');
		pane.className = 'pane';
		pane.append(frame);
		frames[port] = pane;
		document.body.append(pane);
		if (Claude.wasShown(port)) Claude.toggle(port, true);
		highlight();
		frame.src = (await api(`projects/${port}/start`, 'POST')).url;
	}
}

async function refresh() {
	take(await api('projects'));
	render();
}

async function add() {
	const result = await api('projects', 'POST');
	take(result);
	render();
	if (result.port) show(String(result.port));
}

const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
$('#today').textContent = today;

$('#tabs [data-home]').onclick = () => show('');
$('#add').onclick = add;
$('#new-category').onclick = newCategory;
$('#claude').onclick = () => Claude.toggle(current);
$('#code').onclick = () => api(`projects/${current}/code`, 'POST');
addEventListener('keydown', (event) => {
	if (event.ctrlKey && event.key === '`') {
		event.preventDefault();
		Claude.toggle(current);
	}
});

refresh().then(() => show(open.includes(stored('tab', '')) ? stored('tab', '') : ''));

// Live reload: a change in public/ swaps the stylesheet in place or reloads the page,
// and a restarted server (a new boot id) reloads it too.
let boot;
new EventSource('/live').onmessage = ({ data }) => {
	const { id, file } = JSON.parse(data);
	if (boot && boot !== id) return location.reload();
	boot = id;
	if (!file) return;
	if (file.endsWith('.css')) document.querySelectorAll('link[rel=stylesheet]').forEach((l) => (l.href = l.href.split('?')[0] + '?' + Date.now()));
	else location.reload();
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
