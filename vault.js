// Encrypted docs: a doc marked here keeps its body encrypted on disk (vault/backlogs-vault, a
// Secure Enclave key). Unlocking a project asks for Touch ID and decrypts its marked docs in
// place; they lock again after RELOCK_MS, when the project's tab closes, and when the server
// starts or stops.
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

const BIN = path.join(__dirname, 'vault/backlogs-vault');
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
		const title = (fs.readFileSync(file, 'utf8').match(/^title:\s*["']?(.*?)["']?\s*$/m) || [])[1] || name;
		return { file, title, marked: list.includes(file), locked: isLocked(file) };
	});
}

function status(project) {
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

async function act(project, { do: action, file }) {
	const doc = docs(project).find((d) => d.file === file);
	if (action === 'lock') await lock(project);
	else if (action === 'unlock') await unlock(project);
	else if (action === 'mark' && doc) {
		saveMarked([...marked(), file]);
		await run(['lock', file]);
	} else if (action === 'unmark' && doc) {
		if (doc.locked) await run(['unlock', `ne plus chiffrer « ${doc.title} »`, file]);
		saveMarked(marked().filter((f) => f !== file));
	}
	return status(project);
}

// At start and at exit: every marked doc encrypted, whatever happened before.
function lockAllSync() {
	const files = marked().filter((f) => fs.existsSync(f) && !isLocked(f));
	if (files.length) execFileSync(BIN, ['lock', ...files]);
}

function init(dataDir) {
	LIST = path.join(dataDir, 'vault.json');
	if (!fs.existsSync(BIN)) execFileSync('swiftc', ['-O', path.join(__dirname, 'vault/vault.swift'), '-o', BIN]);
	lockAllSync();
}

module.exports = { init, status, act, lock, lockAllSync };
