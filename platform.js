// What differs between macOS and Windows: where data lives, how files, links and folders are opened,
// which `backlog` and `claude` commands run, and the folder picker (the app's own dialog when it runs in Electron).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, execFileSync, spawn } = require('node:child_process');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const HOME = os.homedir();
const DATA_DIR = WIN ? path.join(process.env.APPDATA || path.join(HOME, 'AppData/Roaming'), 'Backlogs') : path.join(HOME, 'Library/Application Support/Backlogs');

// A command on the PATH, or null. On Windows, npm installs `.cmd` shims, which need a shell to run.
function which(name) {
	try {
		const out = execFileSync(WIN ? 'where' : 'which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
		return out.split(/\r?\n/).find(Boolean) || null;
	} catch (e) {
		return null;
	}
}

// `backlog`: the one on the PATH (it may be the fork), else the one shipped with the app (BACKLOG_BIN, set by electron/main.js).
let backlogBin;
function backlog() {
	if (backlogBin === undefined) backlogBin = which('backlog') || (process.env.BACKLOG_BIN && fs.existsSync(process.env.BACKLOG_BIN) ? process.env.BACKLOG_BIN : 'backlog');
	return backlogBin;
}
const shell = (bin) => WIN && /\.(cmd|bat)$/i.test(bin);
function runBacklog(args, cwd, callback) {
	const bin = backlog();
	return execFile(bin, args, { cwd, shell: shell(bin), windowsHide: true }, callback);
}
function spawnBacklog(args, cwd) {
	const bin = backlog();
	return spawn(bin, args, { cwd, stdio: 'ignore', shell: shell(bin), windowsHide: true });
}

// The Claude Code CLI the Agent SDK runs: its own (installed with it, ~350 MB) when present, as from a source
// checkout; else the user's install, as in the desktop app, which leaves the SDK's out.
function claude() {
	const own = `@anthropic-ai/claude-agent-sdk-${WIN ? 'win32' : process.platform}-${process.arch}/package.json`;
	try {
		require.resolve(own);
		return undefined;
	} catch (e) {
		return which('claude') || undefined;
	}
}

const VSCODE = MAC ? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' : WIN ? path.join(process.env.LOCALAPPDATA || '', 'Programs/Microsoft VS Code/bin/code.cmd') : 'code';
const CHROME = MAC ? '/Applications/Google Chrome.app' : WIN ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, 'Google/Chrome/Application/chrome.exe')).find((f) => fs.existsSync(f)) : null;

// Overridden by the Electron app with its own shell.openPath/openExternal and dialog.
const hooks = { open: null, pickFolder: null };

// A file or link in its default app (folders in Finder or Explorer).
function open(target) {
	if (hooks.open) return hooks.open(target);
	if (WIN) execFile('cmd', ['/c', 'start', '""', target], { windowsHide: true });
	else execFile(MAC ? 'open' : 'xdg-open', [target]);
}
// An HTML page (a mockup): shown in Chrome, else the default browser.
function openPage(file) {
	if (CHROME && fs.existsSync(CHROME)) return MAC ? execFile('open', ['-a', CHROME, file]) : execFile(CHROME, [file]);
	open(file);
}
// Code in VS Code, at its line when given; false without VS Code.
function openCode(file, line) {
	const code = fs.existsSync(VSCODE) ? VSCODE : which('code');
	if (!code) return false;
	execFile(code, ['-g', line ? `${file}:${line}` : file], { shell: shell(code), windowsHide: true });
	return true;
}
function openFolderInCode(dir) {
	if (MAC && fs.existsSync('/Applications/Visual Studio Code.app')) return execFile('open', ['-a', 'Visual Studio Code', dir]);
	const code = fs.existsSync(VSCODE) ? VSCODE : which('code');
	if (code) execFile(code, [dir], { shell: shell(code), windowsHide: true });
}

// The folder of a new project, or null when cancelled.
function pickFolder() {
	if (hooks.pickFolder) return hooks.pickFolder();
	if (!MAC) return Promise.resolve(null);
	// Shown by System Events, already running: `tell me to activate` takes osascript ~2 s to become an app.
	const script = 'tell application "System Events"\nactivate\nPOSIX path of (choose folder with prompt "Project folder (a board is created in it if it has none)")\nend tell';
	return new Promise((resolve) => execFile('osascript', ['-e', script], (error, out) => resolve(error ? null : out.trim().replace(/\/$/, ''))));
}

// `claude` in a terminal window, in the folder, with its arguments (resuming a conversation).
function terminal(dir, args) {
	if (MAC) {
		const script = `on run argv
	tell application "Terminal"
		activate
		do script "cd " & quoted form of (item 1 of argv) & " && claude" & (item 2 of argv)
	end tell
end run`;
		return execFile('osascript', ['-e', script, dir, args ? ` ${args}` : '']);
	}
	if (WIN) spawn('cmd', ['/c', 'start', '""', 'cmd', '/k', `claude ${args || ''}`], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
}

module.exports = { WIN, MAC, HOME, DATA_DIR, hooks, backlog, runBacklog, spawnBacklog, claude, open, openPage, openCode, openFolderInCode, pickFolder, terminal };
