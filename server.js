// Backlogs: a home page for every Backlog.md board on this Mac.
// Serves public/ on localhost, keeps the project list, starts each board's
// `backlog browser` on demand and asks macOS for a folder to add one.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const claude = require('./claude');
const vault = require('./vault');
const proxy = require('./proxy');

const PORT = Number(process.env.BACKLOGS_PORT || 6400);
const FIRST_FREE_PORT = 6430;
const HOME = os.homedir();
const DATA_DIR = path.join(HOME, 'Library/Application Support/Backlogs');
const LIST = path.join(DATA_DIR, 'projects.json');
const PUBLIC = path.join(__dirname, 'public');
const ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
// Files served from node_modules: Markdown for the Claude chat.
const VENDOR = {
	'/vendor/marked.js': 'marked/lib/marked.umd.js',
	'/vendor/purify.js': 'dompurify/dist/purify.min.js',
};
const VSCODE = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const TEXT = /\.(md|txt|js|mjs|cjs|ts|tsx|jsx|json|css|scss|html|php|py|rb|sh|zsh|yml|yaml|toml|xml|swift|go|rs|c|h|java|kt|sql)$/i;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const boards = new Map(); // port -> child process started here

// ---- project list ----

function configOf(dir) {
	const file = path.join(dir, 'backlog/config.yml');
	if (!fs.existsSync(file)) return null;
	const text = fs.readFileSync(file, 'utf8');
	const field = (key) => (text.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?`, 'm')) || [])[1];
	return { name: field('project_name') || path.basename(dir), port: Number(field('default_port')) || 0 };
}

function freePort(taken, wanted) {
	if (wanted && !taken.has(wanted)) return wanted;
	let port = FIRST_FREE_PORT;
	while (taken.has(port)) port++;
	return port;
}

// First run: every board found in ~/Projects and ~/Documents (git worktrees skipped).
function discover() {
	const list = [];
	for (const root of ['Projects', 'Documents']) {
		const base = path.join(HOME, root);
		if (!fs.existsSync(base)) continue;
		for (const entry of fs.readdirSync(base)) {
			const dir = path.join(base, entry);
			const git = path.join(dir, '.git');
			if (fs.existsSync(git) && fs.statSync(git).isFile()) continue;
			const config = configOf(dir);
			if (config) list.push({ dir, port: freePort(new Set(list.map((p) => p.port)), config.port) });
		}
	}
	return list;
}

// projects.json: { categories: [name…], projects: [{ dir, port, category? }…] } in display order.
// An older file holds the bare projects array.
function read() {
	if (!fs.existsSync(LIST)) return { categories: [], projects: discover() };
	const data = JSON.parse(fs.readFileSync(LIST, 'utf8'));
	return Array.isArray(data) ? { categories: [], projects: data } : data;
}

function write(data) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(LIST, JSON.stringify(data, null, '\t') + '\n');
}

function load() {
	return read().projects;
}

function save(list) {
	write({ ...read(), projects: list });
}

// Sets the categories and the order and category of every project, from the page.
function arrange({ categories, order }) {
	const names = [...new Set(categories.filter((name) => typeof name === 'string' && name.trim()))];
	const list = load();
	const placed = order.map((o) => list.find((p) => p.port === o.port)).filter(Boolean);
	const projects = [...placed, ...list.filter((p) => !placed.includes(p))].map(({ category, ...p }) => {
		const wanted = order.find((o) => o.port === p.port)?.category ?? category;
		return names.includes(wanted) ? { ...p, category: wanted } : p;
	});
	write({ categories: names, projects });
}

function state() {
	const list = load();
	return { categories: read().categories, projects: describe(list), alerts: alerts(list) };
}

function counts(dir) {
	const result = { todo: 0, doing: 0, done: 0 };
	const tasks = path.join(dir, 'backlog/tasks');
	if (!fs.existsSync(tasks)) return result;
	for (const file of fs.readdirSync(tasks)) {
		if (!file.endsWith('.md')) continue;
		const status = (fs.readFileSync(path.join(tasks, file), 'utf8').match(/^status:\s*(.+)$/m) || [])[1];
		if (status === 'Done') result.done++;
		else if (status === 'In Progress') result.doing++;
		else result.todo++;
	}
	return result;
}

// ---- alerts: open tasks with a due date, and recurring ones ----

// The fields read from a task file's front matter.
function frontMatter(text) {
	const head = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
	const field = (key) => {
		const value = (head.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm')) || [])[1]?.trim() || '';
		return value.replace(/^'(.*)'$/, (_, inner) => inner.replace(/''/g, "'")).replace(/^"(.*)"$/, '$1');
	};
	const block = (head.match(/^labels:[ \t]*\n((?:[ \t]+-.*\n?)*)/m) || [])[1] || '';
	const inline = (head.match(/^labels:[ \t]*\[(.*)\]/m) || [])[1] || '';
	const labels = [...block.matchAll(/-\s*(.+)/g)].map((m) => m[1]).concat(inline.split(','))
		.map((l) => l.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
	return { id: field('id'), title: field('title'), status: field('status'), due: field('due_date').slice(0, 10), labels };
}

function tasksOf(dir) {
	const folder = path.join(dir, 'backlog/tasks');
	if (!fs.existsSync(folder)) return [];
	return fs.readdirSync(folder).filter((f) => f.endsWith('.md')).map((f) => ({ file: path.join(folder, f), ...frontMatter(fs.readFileSync(path.join(folder, f), 'utf8')) }));
}

// Recurrence labels and the months between two due dates.
const EVERY = { mensuel: 1, trimestriel: 3, annuel: 12 };
const every = (task) => task.labels.find((l) => EVERY[l.toLowerCase()]);

// n months later, on the given day of the month (the month's last day when it has fewer).
function addMonths(date, n, day) {
	const [y, m] = date.split('-').map(Number);
	const target = new Date(Date.UTC(y, m - 1 + n, 1));
	const days = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, days));
	return target.toISOString().slice(0, 10);
}

// The day of the month a recurring task falls on: the latest one among its occurrences,
// so a deadline cut short by February (31 → 28) comes back to the 31st.
function anchorDay(dir, task) {
	const folders = ['backlog/tasks', 'backlog/completed', 'backlog/archive/tasks'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
	const days = folders.flatMap((folder) => fs.readdirSync(folder).filter((f) => f.endsWith('.md')).map((f) => frontMatter(fs.readFileSync(path.join(folder, f), 'utf8'))))
		.filter((t) => t.title === task.title && /^\d{4}-\d{2}-\d{2}$/.test(t.due))
		.map((t) => Number(t.due.slice(8)));
	return Math.max(Number(task.due.slice(8)), ...days);
}

function run(args, cwd) {
	return new Promise((resolve, reject) => execFile('backlog', args, { cwd }, (error, out) => (error ? reject(error) : resolve(out))));
}

// A recurring task marked Done gets its next occurrence; the done one loses its label, so it happens once.
const recurring = new Set(); // dirs being handled
async function recur(dir) {
	if (recurring.has(dir)) return;
	recurring.add(dir);
	try {
		for (const task of tasksOf(dir)) {
			const label = every(task);
			if (task.status !== 'Done' || !label || !/^\d{4}-\d{2}-\d{2}$/.test(task.due)) continue;
			const text = fs.readFileSync(task.file, 'utf8');
			const description = (text.match(/<!-- SECTION:DESCRIPTION:BEGIN -->\n?([\s\S]*?)\n?<!-- SECTION:DESCRIPTION:END -->/) || [])[1] || '';
			const priority = (text.match(/^priority:\s*(\w+)/m) || [])[1];
			const args = ['task', 'create', task.title, '--due-date', addMonths(task.due, EVERY[label.toLowerCase()], anchorDay(dir, task)), '--labels', task.labels.join(','), '--plain'];
			if (description.trim()) args.push('--description', description.trim());
			if (priority) args.push('--priority', priority);
			await run(args, dir);
			await run(['task', 'edit', task.id, '--remove-label', label], dir);
		}
	} catch (error) {
		console.error('recur', dir, error.message);
	} finally {
		recurring.delete(dir);
	}
}

function alerts(list) {
	return list.flatMap((p) => {
		const config = configOf(p.dir);
		if (!config) return [];
		return tasksOf(p.dir)
			.filter((t) => t.status !== 'Done' && /^\d{4}-\d{2}-\d{2}$/.test(t.due))
			.map((t) => ({ port: p.port, project: config.name, id: t.id, title: t.title, due: t.due, every: every(t) || null }));
	}).sort((a, b) => a.due.localeCompare(b.due) || a.project.localeCompare(b.project));
}

function describe(list) {
	return list
		.filter((p) => configOf(p.dir))
		.map((p) => ({ ...p, name: configOf(p.dir).name, place: p.dir.replace(HOME, '~'), ...counts(p.dir) }));
}

// ---- boards ----

function listening(port) {
	return new Promise((resolve) => {
		const socket = net.connect(port, '127.0.0.1');
		socket.once('connect', () => { socket.destroy(); resolve(true); });
		socket.once('error', () => resolve(false));
	});
}

async function start(project) {
	if (!(await listening(project.port))) {
		const child = spawn('backlog', ['browser', '--port', String(project.port), '--no-open'], { cwd: project.dir, stdio: 'ignore' });
		child.on('exit', () => boards.delete(project.port));
		boards.set(project.port, child);
		for (let i = 0; i < 50 && !(await listening(project.port)); i++) await new Promise((r) => setTimeout(r, 100));
	}
	return `http://localhost:${await proxy.open(project.port)}`;
}

function stop(port) {
	boards.get(port)?.kill();
}

// macOS folder dialog; resolves to a path, or null when cancelled.
function pickFolder() {
	// Shown by System Events, already running: `tell me to activate` takes osascript ~2 s to become an app.
	const script = 'tell application "System Events"\nactivate\nPOSIX path of (choose folder with prompt "Dossier du projet (un tableau y sera créé s\'il n\'en a pas)")\nend tell';
	return new Promise((resolve) => execFile('osascript', ['-e', script], (error, out) => resolve(error ? null : out.trim().replace(/\/$/, ''))));
}

function init(dir) {
	const args = ['init', path.basename(dir), '--defaults', '--integration-mode', 'none'];
	if (!fs.existsSync(path.join(dir, '.git'))) args.push('--no-git');
	return new Promise((resolve, reject) => execFile('backlog', args, { cwd: dir }, (error) => (error ? reject(error) : resolve())));
}

async function add() {
	const dir = await pickFolder();
	if (!dir) return null;
	const list = load();
	if (!list.some((p) => p.dir === dir)) {
		if (!configOf(dir)) await init(dir);
		list.push({ dir, port: freePort(new Set(list.map((p) => p.port)), configOf(dir).port) });
		save(list);
	}
	return list.find((p) => p.dir === dir).port;
}

// ---- http ----

function send(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

function body(req) {
	return new Promise((resolve, reject) => {
		let text = '';
		req.on('data', (chunk) => (text += chunk));
		req.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
	});
}

// A path from the chat: absolute, `~/…`, `file://…` or relative to the project, with an optional `:line`.
function localPath(project, ref) {
	let text = decodeURIComponent(String(ref || '').replace(/^file:\/\//, ''));
	const [, file, line] = text.match(/^(.*?)(?::(\d+))?(?::\d+)?$/);
	text = file.replace(/^~(?=\/|$)/, HOME);
	return { file: path.resolve(project.dir, text), line };
}

// Opens a web link in the default browser, or a file: code at its line in VS Code, anything else in its default app (folders in Finder).
function openLocal(project, ref) {
	if (/^(https?|mailto):/i.test(ref)) return execFile('open', [ref]), true;
	const { file, line } = localPath(project, ref);
	if (!fs.existsSync(file)) return false;
	if (TEXT.test(file) && fs.existsSync(VSCODE)) execFile(VSCODE, ['-g', line ? `${file}:${line}` : file]);
	else execFile('open', [file]);
	return true;
}

function serveImage(project, ref, res) {
	const { file } = localPath(project, ref);
	const type = IMAGES[path.extname(file).toLowerCase()];
	if (!type || !fs.existsSync(file)) return send(res, 404, {});
	res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
	fs.createReadStream(file).pipe(res);
}

async function api(req, res) {
	const url = new URL(req.url, 'http://localhost');
	const [, , resource, id, action] = url.pathname.split('/');
	const list = load();
	const project = list.find((p) => String(p.port) === id);
	// Changes only from the app's own page, never from another site open in the browser.
	if (req.method !== 'GET' && !ORIGINS.includes(req.headers.origin)) return send(res, 403, {});
	if (resource === 'layout' && req.method === 'PUT') {
		arrange(await body(req));
		return send(res, 200, state());
	}
	if (resource !== 'projects') return send(res, 404, {});
	if (req.method === 'GET' && !id) {
		await Promise.all(list.map((p) => recur(p.dir)));
		return send(res, 200, state());
	}
	if (req.method === 'POST' && !id) return send(res, 200, { port: await add(), ...state() });
	if (!project) return send(res, 404, {});
	if (req.method === 'POST' && action === 'start') return send(res, 200, { url: await start(project) });
	if (req.method === 'POST' && action === 'terminal') {
		claude.openInTerminal(project);
		return send(res, 200, {});
	}
	if (req.method === 'POST' && action === 'code') {
		execFile('open', ['-a', 'Visual Studio Code', project.dir]);
		return send(res, 200, {});
	}
	if (req.method === 'GET' && action === 'image') return serveImage(project, url.searchParams.get('path'), res);
	if (req.method === 'POST' && action === 'open') return send(res, 200, { ok: openLocal(project, (await body(req)).path) });
	if (req.method === 'GET' && action === 'vault') return send(res, 200, vault.status(project));
	if (req.method === 'POST' && action === 'vault') return send(res, 200, await vault.act(project, await body(req)));
	if (req.method === 'GET' && action === 'sessions') return send(res, 200, await claude.sessions(project));
	if (req.method === 'DELETE' && action === 'claude') {
		claude.stop(project.port);
		return send(res, 200, {});
	}
	if (req.method === 'DELETE' && !action) {
		stop(project.port);
		claude.stop(project.port);
		save(list.filter((p) => p !== project));
		return send(res, 200, state());
	}
	send(res, 404, {});
}

function serveFile(req, res) {
	const url = req.url.split('?')[0];
	const name = url === '/' ? 'index.html' : path.normalize(url).replace(/^\/+/, '');
	const file = VENDOR[url] ? path.join(__dirname, 'node_modules', VENDOR[url]) : path.join(PUBLIC, name);
	if (!(VENDOR[url] || file.startsWith(PUBLIC)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		res.writeHead(404);
		return res.end();
	}
	res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
	fs.createReadStream(file).pipe(res);
}

// ---- live reload: tells the open pages when a file in public/ changes ----

const BOOT = String(Date.now());
const listeners = new Set();
let pending, changed;
const stamps = new Map(); // file -> last modification time seen
for (const file of fs.readdirSync(PUBLIC, { recursive: true })) stamps.set(file, fs.statSync(path.join(PUBLIC, file)).mtimeMs);
fs.watch(PUBLIC, { recursive: true }, (event, file) => {
	// Only code and styles, and only real edits: opening a file (an image from the chat) touches its metadata.
	if (!/\.(js|html|css)$/.test(file || '')) return;
	const time = fs.statSync(path.join(PUBLIC, file), { throwIfNoEntry: false })?.mtimeMs;
	if (time === stamps.get(file)) return;
	stamps.set(file, time);
	// Changes come in bursts: send one message, a script or page winning over a stylesheet.
	if (!changed?.match(/\.(js|html)$/)) changed = file;
	clearTimeout(pending);
	pending = setTimeout(() => {
		listeners.forEach((res) => res.write(`data: ${JSON.stringify({ id: BOOT, file: changed })}\n\n`));
		changed = null;
	}, 100);
});

function live(req, res) {
	res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
	res.write(`data: ${JSON.stringify({ id: BOOT })}\n\n`);
	listeners.add(res);
	req.on('close', () => listeners.delete(res));
}

const server = http.createServer((req, res) => {
	if (req.url === '/live') live(req, res);
	else if (req.url.startsWith('/api/')) api(req, res).catch((error) => send(res, 500, { error: error.message }));
	else serveFile(req, res);
});
vault.init(DATA_DIR);
claude.attach(server, (port) => load().find((p) => String(p.port) === port), ORIGINS, DATA_DIR);
server.listen(PORT, '127.0.0.1', () => console.log(`Backlogs on http://localhost:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		for (const child of boards.values()) child.kill();
		claude.stopAll();
		vault.lockAllSync();
		process.exit(0);
	});
}
