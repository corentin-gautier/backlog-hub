// One tab per project; each board loads in its own iframe, kept so it stays where it was left.
const frames = {};
let projects = [];
let current = '';

const $ = (selector) => document.querySelector(selector);
const api = (url, method = 'GET') => fetch(`/api/${url}`, { method }).then((res) => res.json());

function remember(port) {
	try { localStorage.setItem('tab', port); } catch (e) {}
}

function lastTab() {
	try { return localStorage.getItem('tab') || ''; } catch (e) { return ''; }
}

function render() {
	$('#tabs').replaceChildren($('#tabs [data-home]'), ...projects.map((p) => {
		const tab = document.createElement('button');
		tab.textContent = p.name;
		tab.dataset.port = p.port;
		tab.onclick = () => show(String(p.port));
		return tab;
	}));
	$('#cards').replaceChildren(...projects.map(card), newCard());
	highlight();
}

function card(p) {
	const el = document.createElement('div');
	el.className = 'card';
	el.innerHTML = '<b></b><span class="place"></span><span class="count"></span><button class="remove" title="Retirer de la liste (le dossier reste)">×</button>';
	el.querySelector('b').textContent = p.name;
	el.querySelector('.place').textContent = p.place;
	el.querySelector('.count').textContent = `${p.todo} à faire · ${p.doing} en cours · ${p.done} faits`;
	el.onclick = () => show(String(p.port));
	el.querySelector('.remove').onclick = async (event) => {
		event.stopPropagation();
		if (!confirm(`Retirer « ${p.name} » de la liste ? Le dossier et ses tâches restent.`)) return;
		frames[p.port]?.remove();
		delete frames[p.port];
		projects = await api(`projects/${p.port}`, 'DELETE');
		render();
	};
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
	Object.entries(frames).forEach(([port, frame]) => frame.classList.toggle('on', port === current));
}

async function show(port) {
	current = port;
	remember(port);
	highlight();
	if (!port) return refresh();
	if (!frames[port]) {
		const frame = document.createElement('iframe');
		frames[port] = frame;
		document.body.append(frame);
		highlight();
		frame.src = (await api(`projects/${port}/start`, 'POST')).url;
	}
}

async function refresh() {
	projects = await api('projects');
	render();
}

async function add() {
	const result = await api('projects', 'POST');
	projects = result.projects;
	render();
	if (result.port) show(String(result.port));
}

$('#tabs [data-home]').onclick = () => show('');
$('#add').onclick = add;

refresh().then(() => show(projects.some((p) => String(p.port) === lastTab()) ? lastTab() : ''));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
