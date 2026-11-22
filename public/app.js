// One tab per open project; each board loads in its own pane (an iframe, and Claude Code beside it),
// kept so it stays where it was left.
const frames = {};
let projects = [];
let alerts = [];
let doing = [];
let categories = [];
let current = '';

const $ = (selector) => document.querySelector(selector);
const api = (url, method = 'GET', body) =>
	fetch(`/api/${url}`, { method, body: body && JSON.stringify(body), headers: body && { 'Content-Type': 'application/json' } }).then((res) => res.json());

function take(state) {
	categories = state.categories;
	projects = state.projects;
	alerts = state.alerts || [];
	doing = state.doing || [];
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
	renderTop();
	highlight();
}

// Categories folded down to their heading, per browser.
const foldedCats = new Set(stored('foldedCats', []));
function fold(name, value) {
	value ? foldedCats.add(name) : foldedCats.delete(name);
	store('foldedCats', [...foldedCats]);
}

// A section of cards; '' is the uncategorized one, last, shown when it holds a project or while one is dragged.
function group(name, list) {
	const el = document.createElement('section');
	el.className = 'group';
	el.dataset.cat = name;
	el.innerHTML = `<h2><button class="fold" title="Fold or unfold"><i class="chevron"></i></button><span class="cat"></span><span class="count"></span></h2><div class="cards"></div>`;
	el.querySelector('.cat').textContent = name || 'Uncategorized';
	el.querySelector('.count').textContent = list.length;
	el.querySelector('.cards').append(...list.map(card));
	el.classList.toggle('folded', foldedCats.has(name));
	el.querySelector('.fold').onclick = () => {
		fold(name, !foldedCats.has(name));
		el.classList.toggle('folded', foldedCats.has(name));
	};
	if (!name) {
		el.querySelector('h2').classList.add('none');
		el.classList.toggle('empty', !list.length);
		return el;
	}
	const head = el.querySelector('h2');
	draggable(head, 'group');
	head.title = 'Drag to move the category';
	const actions = document.createElement('span');
	actions.className = 'acts';
	actions.innerHTML = '<button>Rename</button><button>Delete</button>';
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
		if (foldedCats.has(before)) fold(before, false), fold(name, true);
		projects.forEach((p) => p.category === before && (p.category = name));
		persist();
	};
}

function newCategory() {
	let name = 'New category';
	for (let i = 2; categories.includes(name); i++) name = `New category ${i}`;
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

// ---- drag and drop: cards between and within sections, sections (tabs: reorderable, below) ----

let dragged = null; // the element being moved: a card, a section or a tab

function draggable(el, kind) {
	el.draggable = true;
	el.addEventListener('dragstart', (event) => {
		event.stopPropagation();
		dragged = kind === 'group' ? el.closest('.group') : el;
		dragged.dataset.kind = kind;
		event.dataTransfer.effectAllowed = 'move';
		if (kind === 'group') event.dataTransfer.setDragImage(el, 20, 12);
		requestAnimationFrame(() => (dragged?.classList.add('dragging'), document.body.classList.toggle('moving-card', kind === 'card')));
	});
	el.addEventListener('dragend', () => {
		if (!dragged) return;
		const kind = dragged.dataset.kind;
		dragged.classList.remove('dragging');
		document.body.classList.remove('moving-card');
		document.querySelectorAll('.target').forEach((t) => t.classList.remove('target'));
		dragged = null;
		readLayout();
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
		const item = event.target.closest('.card');
		if (item && cards.contains(item)) place(event, item);
		else if (dragged.parentElement !== cards) cards.append(dragged);
		document.querySelectorAll('.target').forEach((t) => t !== cards.parentElement && t.classList.remove('target'));
		cards.parentElement.classList.add('target');
	} else if (kind === 'group') {
		event.preventDefault();
		const item = event.target.closest('.group');
		if (item && item.dataset.cat) place(event, item, true);
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
	el.onclick = () => !el.dataset.moved && show(String(p.port));
	const dot = document.createElement('span');
	dot.className = 'dot';
	dot.textContent = p.name[0].toUpperCase();
	dot.style.background = colour(p.name);
	const close = document.createElement('span');
	close.className = 'close';
	close.title = 'Close';
	close.textContent = '×';
	close.onclick = (event) => {
		event.stopPropagation();
		closeTab(String(p.port));
	};
	// Middle click closes the tab, as in a browser (mousedown is cancelled to skip autoscroll).
	el.onmousedown = (event) => event.button === 1 && event.preventDefault();
	el.onauxclick = (event) => event.button === 1 && closeTab(String(p.port));
	el.append(dot, p.name, close);
	reorderable(el);
	return el;
}

// Tabs move with the pointer rather than HTML drag and drop: WebKit (Safari, the Mac app) never drags a <button>.
// The held tab follows the pointer; the others slide out of its way. Its place is read from the tabs' layout
// (offsetLeft, which ignores the transforms of the animation), so tabs of any width never swap back and forth.
const SLIDE = 'transform .18s cubic-bezier(.2, .8, .2, 1)';
function reorderable(el) {
	el.addEventListener('pointerdown', (down) => {
		if (down.button !== 0 || down.target.closest('.close')) return;
		const start = el.offsetLeft;
		let moving = false;
		el.setPointerCapture(down.pointerId); // keeps the moves when the pointer leaves the bar (over a board's frame)
		const offset = (event) => event.clientX - down.clientX - (el.offsetLeft - start); // the held tab's shift from its slot
		const move = (event) => {
			if (!moving && Math.abs(event.clientX - down.clientX) < 5) return;
			if (!moving) {
				moving = true;
				el.classList.add('lifted');
				el.style.transition = 'none';
			}
			// Its slot: after every other tab whose middle its own middle has passed.
			const centre = el.offsetLeft + offset(event) + el.offsetWidth / 2;
			const others = [...document.querySelectorAll('#tabs [data-port]')].filter((t) => t !== el);
			const index = others.filter((t) => t.offsetLeft + t.offsetWidth / 2 < centre).length;
			const next = others[index] || null;
			if (el.nextElementSibling !== next) {
				const before = new Map(others.map((t) => [t, t.getBoundingClientRect().left]));
				if (next) next.before(el);
				else others.at(-1).after(el);
				for (const t of others) {
					t.style.transition = 'none';
					t.style.transform = '';
					const dx = before.get(t) - t.getBoundingClientRect().left;
					if (!dx) continue;
					t.style.transform = `translateX(${dx}px)`;
					t.offsetWidth; // apply the start position before animating back to the slot
					t.style.transition = SLIDE;
					t.style.transform = '';
				}
			}
			el.style.transform = `translateX(${offset(event)}px)`;
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			el.removeEventListener('pointercancel', up);
			if (!moving) return;
			// The held tab settles into its slot.
			el.style.transition = SLIDE;
			el.style.transform = '';
			setTimeout(() => (el.classList.remove('lifted'), (el.style.transition = '')), 200);
			el.dataset.moved = 1; // the click that ends the move does not open the tab
			setTimeout(() => delete el.dataset.moved);
			open = [...document.querySelectorAll('#tabs [data-port]')].map((t) => t.dataset.port);
			store('open', open);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
	});
}

// ---- the row above the projects: Coming up, In progress, the general chat ----
// Toggles beside the title show or hide each part (remembered per browser); the shown parts share the row.

const SHOWN = 5;
const showAll = new Set(); // lists showing every row
const off = new Set(stored('off', []));
const toggles = {}; // part -> its button

function renderTop() {
	list('alerts', alerts, alertRow);
	list('doing', doing, doingRow);
	const parts = [...document.querySelectorAll('#top .part')];
	for (const el of parts) {
		const name = el.dataset.part;
		const empty = name !== 'claude' && !(name === 'alerts' ? alerts : doing).length;
		toggles[name].hidden = empty;
		toggles[name].setAttribute('aria-pressed', !off.has(name));
		el.hidden = empty || off.has(name);
	}
	const shown = parts.filter((el) => !el.hidden);
	$('#top').hidden = !shown.length;
	$('#top').style.gridTemplateColumns = shown.map(() => 'minmax(0, 1fr)').join(' ');
	$('#top').classList.toggle('solo', shown.length === 1 && shown[0].dataset.part === 'claude');
}

for (const part of document.querySelectorAll('#top .part')) {
	const name = part.dataset.part;
	const button = (toggles[name] = document.createElement('button'));
	button.innerHTML = '<i class="tick"></i><span></span>';
	button.children[1].textContent = part.querySelector('h2').firstChild.textContent.trim();
	button.title = 'Show or hide on the home';
	button.onclick = () => {
		off.has(name) ? off.delete(name) : off.add(name);
		store('off', [...off]);
		renderTop();
	};
	$('#toggles').append(button);
}

// A list of tasks (hidden when empty): the first rows, then a button for the rest.
function list(name, items, row) {
	const el = $(`.part[data-part="${name}"]`);
	el.hidden = !items.length;
	el.querySelector('.count').textContent = items.length;
	const box = el.querySelector('.alerts');
	box.replaceChildren(...(showAll.has(name) ? items : items.slice(0, SHOWN)).map(row));
	if (items.length <= SHOWN) return;
	const more = document.createElement('button');
	more.className = 'more';
	more.textContent = showAll.has(name) ? 'Show less' : `Show ${items.length - SHOWN} more`;
	more.onclick = () => {
		showAll.has(name) ? showAll.delete(name) : showAll.add(name);
		renderTop();
	};
	box.append(more);
}

// The project's dot, its name and the task id, under a title.
function taskLine(el, t) {
	el.querySelector('.title').textContent = t.title;
	const dot = el.querySelector('.dot');
	dot.textContent = t.project[0].toUpperCase();
	dot.style.background = colour(t.project);
	dot.after(`${t.project} · ${t.id}`);
	el.onclick = () => show(String(t.port), `tasks/${t.id}`);
}

function doingRow(t) {
	const el = document.createElement('div');
	el.className = 'alert';
	el.innerHTML = '<div class="what"><div class="title"></div><div class="sub"><i class="dot"></i></div></div>';
	taskLine(el, t);
	return el;
}

// Coming up: open tasks with a due date, soonest first.
// Recurrence labels (the French ones still work).
const EVERY = { monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly', mensuel: 'monthly', trimestriel: 'quarterly', annuel: 'yearly' };

function daysUntil(date) {
	const [y, m, d] = date.split('-').map(Number);
	const now = new Date();
	return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
}

function when(days) {
	if (days === 0) return 'today';
	if (days === 1) return 'tomorrow';
	if (days === -1) return 'yesterday';
	if (days < 0) return `${-days} days late`;
	if (days < 60) return `in ${days} days`;
	return `in ${Math.round(days / 30.4)} months`;
}

function alertRow(a) {
	const days = daysUntil(a.due);
	const date = new Date(`${a.due}T12:00`);
	const el = document.createElement('div');
	el.className = 'alert' + (days < 0 ? ' late' : days <= 7 ? ' soon' : '');
	el.innerHTML = `<div class="date"><b></b><span></span></div><div class="what"><div class="title"></div><div class="sub"><i class="dot"></i></div></div><div class="when"></div>`;
	el.querySelector('.date b').textContent = date.getDate();
	el.querySelector('.date span').textContent = date.toLocaleDateString(undefined, { month: 'short' });
	el.querySelector('.date').title = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
	taskLine(el, a);
	if (a.every) {
		const tag = document.createElement('span');
		tag.className = 'every';
		tag.textContent = EVERY[a.every.toLowerCase()];
		el.querySelector('.title').append(tag);
	}
	el.querySelector('.when').textContent = when(days);
	return el;
}

function closeTab(port) {
	const index = open.indexOf(port);
	open.splice(index, 1);
	Claude.stop(port);
	Vault.lock(port);
	frames[port]?.remove();
	delete frames[port];
	if (current === port) show(open[Math.min(index, open.length - 1)] || '');
	render();
}

// A colour per project, picked from its name so it stays the same.
function colour(name) {
	let hash = 0;
	for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
	return `var(--p${hash % 8})`; // the palette's project colours (style.css)
}

function card(p) {
	const total = p.todo + p.doing + p.done || 1;
	const el = document.createElement('div');
	el.className = 'card';
	el.dataset.port = p.port;
	el.innerHTML = `
		<div class="top"><div class="avatar"></div><div style="min-width:0"><div class="name"></div><div class="place"></div></div></div>
		<div class="progress"><i style="width:${(p.done / total) * 100}%;background:var(--done)"></i><i style="width:${(p.doing / total) * 100}%;background:var(--doing)"></i></div>
		<div class="stats"><span><b>${p.done}</b> done</span><span><b>${p.doing}</b> in progress</span><span><b>${p.todo}</b> to do</span></div>
		<button class="code" title="Open in VS Code"><svg viewBox="0 0 16 16"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg></button>
		<button class="remove" title="Remove from the list (the folder stays)">×</button>`;
	el.querySelector('.avatar').textContent = p.name[0].toUpperCase();
	el.querySelector('.avatar').style.background = colour(p.name);
	el.querySelector('.name').textContent = p.name;
	el.querySelector('.place').textContent = p.place;
	el.onclick = () => show(String(p.port));
	el.querySelector('.code').hidden = !p.code;
	el.querySelector('.code').onclick = (event) => {
		event.stopPropagation();
		api(`projects/${p.port}/code`, 'POST');
	};
	el.querySelector('.remove').onclick = async (event) => {
		event.stopPropagation();
		if (!confirm(`Remove “${p.name}” from the list? The folder and its tasks stay.`)) return;
		if (open.includes(String(p.port))) closeTab(String(p.port));
		take(await api(`projects/${p.port}`, 'DELETE'));
		render();
	};
	draggable(el, 'card');
	return el;
}

function highlight() {
	document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', (b.dataset.port || '') === current));
	$('#home').classList.toggle('on', !current);
	Object.entries(frames).forEach(([port, pane]) => pane.classList.toggle('on', port === current));
	$('#claude').hidden = !current;
	$('#code').hidden = !projects.find((p) => String(p.port) === current)?.code;
	$('#claude').classList.toggle('on', Claude.visible(current));
}

// Shows a project's tab (Home for ''), at a page of its board when given one.
async function show(port, page) {
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
		frame.src = (await api(`projects/${port}/start`, 'POST')).url + (page ? `/${page}` : '');
	} else if (page) {
		const frame = frames[port].querySelector('iframe');
		frame.src = new URL(`/${page}`, frame.src).href;
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

const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
$('#today').textContent = today;

$('#tabs [data-home]').onclick = () => show('');

// ---- the add button (bottom right of the home): a project or a category ----
const fab = $('#fab');
function openFab(value) {
	fab.querySelector('.menu').hidden = !value;
	fab.classList.toggle('open', value);
	fab.querySelector('.main').setAttribute('aria-expanded', value);
}
fab.querySelector('.main').onclick = () => openFab(fab.querySelector('.menu').hidden);
fab.querySelector('[data-act=project]').onclick = () => (openFab(false), add());
fab.querySelector('[data-act=category]').onclick = () => (openFab(false), newCategory());
document.addEventListener('pointerdown', (event) => !fab.contains(event.target) && openFab(false));
document.addEventListener('keydown', (event) => event.key === 'Escape' && openFab(false));

// ---- theme: light, dark or the system's, per browser; the boards follow it (Backlog.md fork). And the palette. ----
const THEMES = {
	light: 'M8 4.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4ZM8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9',
	system: 'M2 3.5h12v7.5H2ZM6 13.5h4M8 11v2.5',
	dark: 'M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8Z',
};
let theme = stored('theme', 'system');
// The palette: Backlog.md's (default) or Paper; the window's bar colour for each, light and dark.
const BARS = { default: { light: '#f3f4f6', dark: '#030712' }, paper: { light: '#f1ebdf', dark: '#161411' } };
let palette = stored('palette', 'default');
if (!BARS[palette]) palette = 'default';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const shade = () => (theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : theme);
function applyTheme() {
	document.documentElement.dataset.theme = shade();
	document.documentElement.dataset.palette = palette;
	document.querySelector('meta[name=theme-color]').content = BARS[palette][shade()];
	document.querySelectorAll('#palette button').forEach((b) => b.setAttribute('aria-checked', b.dataset.palette === palette));
	document.querySelectorAll('#theme button').forEach((b) => b.setAttribute('aria-checked', b.dataset.theme === theme));
	for (const pane of Object.values(frames)) pane.querySelector('iframe')?.contentWindow?.postMessage({ backlogHub: 'theme', theme: shade() }, '*');
}
function setTheme(value) {
	theme = value;
	store('theme', value);
	applyTheme();
}
for (const [name, d] of Object.entries(THEMES)) {
	const button = document.createElement('button');
	button.dataset.theme = name;
	button.setAttribute('role', 'radio');
	button.title = { light: 'Light', system: 'Same as macOS', dark: 'Dark' }[name];
	button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
	button.onclick = () => setTheme(name);
	$('#theme').append(button);
}
for (const name of Object.keys(BARS)) {
	const button = document.createElement('button');
	button.dataset.palette = name;
	button.setAttribute('role', 'radio');
	button.textContent = { default: 'Default', paper: 'Paper' }[name];
	button.onclick = () => {
		palette = name;
		store('palette', name);
		applyTheme();
	};
	$('#palette').append(button);
}
darkQuery.addEventListener('change', applyTheme);
// A board asks for the theme when it loads, and its own toggle changes it here.
addEventListener('message', (event) => {
	const message = event.data;
	if (message?.backlogHub !== 'theme') return;
	if (!Object.values(frames).some((pane) => pane.querySelector('iframe')?.contentWindow === event.source)) return;
	if (message.do === 'set' && ['light', 'dark'].includes(message.theme)) setTheme(message.theme === (darkQuery.matches ? 'dark' : 'light') ? 'system' : message.theme);
	else event.source.postMessage({ backlogHub: 'theme', theme: shade() }, '*');
});
applyTheme();
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
