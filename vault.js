// Encrypted docs: a doc marked here keeps its body encrypted on disk (vault/backlogs-vault, a
// Secure Enclave key). Unlocking a project asks for Touch ID and decrypts its marked docs in
// place; they lock again after RELOCK_MS, when the project's tab closes, and when the server
// starts or stops. macOS only: elsewhere no doc can be marked.
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

// Built from vault/vault.swift on first use from a source checkout; shipped prebuilt in the desktop app (VAULT_BIN).
const BIN = process.env.VAULT_BIN || path.join(__dirname, 'vault/backlogs-vault');
const AVAILABLE = process.platform === 'darwin';
const MARKER = '<!-- backlogs-vault v1 ';
const RELOCK_MS = 5 * 60 * 1000;
let LIST;
const timers = new Map(); // project dir -> { timer, until }

const marked = () => (fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, 'utf8')).files : []);
const saveMarked = (files) => fs.writeFileSync(LIST, JSON.stringify({ files: [...new Set(files)].sort() }, null, '\t') + '\n');
const isLocked = (file) => fs.readFileSync(file, 'utf8').includes(MARKER);
const docsDir = (project) => path.join(project.dir, 'backlog/docs');
const ofProject = (project) => marked().filter((f) => f.startsWith(docsDir(project) + path.sep) && fs.existsSync(f));
const run = (args) => new Promise((resolve, reject) => execFile(BIN, args, (error, out, err) => (error ? reject(new Error(err.trim() || error.message)) : resolve())));

function docs(project) {
	const dir = docsDir(project);
	if (!fs.existsSync(dir)) return [];
	const list = marked();
	return fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md')).sort().map((name) => {
		const file = path.join(dir, name);
		const text = fs.readFileSync(file, 'utf8');
		const field = (key) => (text.match(new RegExp(`^${key}:\\s*["']?(.*?)["']?\\s*$`, 'm')) || [])[1];
		return { file, id: (field('id') || '').toLowerCase(), title: field('title') || name, marked: list.includes(file), locked: isLocked(file) };
	});
}

function status(project) {
	if (!AVAILABLE) return { docs: [], until: null, unavailable: true };
	const until = timers.get(project.dir)?.until || null;
	return { docs: docs(project), until: ofProject(project).some((f) => !isLocked(f)) ? until : null };
}

async function lock(project) {
	clearTimeout(timers.get(project.dir)?.timer);
	timers.delete(project.dir);
	const files = ofProject(project).filter((f) => !isLocked(f));
	if (files.length) await run(['lock', ...files]);
}

async function unlock(project, files = ofProject(project).filter(isLocked)) {
	if (files.length) await run(['unlock', `unlock the encrypted docs of ${path.basename(project.dir)}`, ...files]);
	clearTimeout(timers.get(project.dir)?.timer);
	const timer = setTimeout(() => lock(project).catch(console.error), RELOCK_MS);
	timers.set(project.dir, { timer, until: Date.now() + RELOCK_MS });
}

// A doc is given by its id (the board's doc page) or its file.
async function act(project, { do: action, id, file }) {
	if (!AVAILABLE) return status(project);
	const doc = docs(project).find((d) => (id ? d.id === String(id).toLowerCase() : d.file === file));
	file = doc?.file;
	if (action === 'lock') await lock(project);
	else if (action === 'unlock') await unlock(project);
	else if (action === 'mark' && doc) {
		saveMarked([...marked(), file]);
		// Unlocked project: the doc stays readable and locks with the others; else it locks now.
		if (!timers.has(project.dir)) await run(['lock', file]);
	} else if (action === 'unmark' && doc) {
		if (doc.locked) await run(['unlock', `stop encrypting “${doc.title}”`, file]);
		saveMarked(marked().filter((f) => f !== file));
	}
	return status(project);
}

// At start and at exit: every marked doc encrypted, whatever happened before.
function lockAllSync() {
	if (!AVAILABLE) return;
	const files = marked().filter((f) => fs.existsSync(f) && !isLocked(f));
	if (files.length) execFileSync(BIN, ['lock', ...files]);
}

function init(dataDir) {
	LIST = path.join(dataDir, 'vault.json');
	if (!AVAILABLE) return;
	if (!fs.existsSync(BIN)) execFileSync('swiftc', ['-O', path.join(__dirname, 'vault/vault.swift'), '-o', BIN]);
	lockAllSync();
}

module.exports = { init, status, act, lock, lockAllSync };
