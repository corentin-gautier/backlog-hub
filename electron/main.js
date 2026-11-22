// Backlog Hub as a desktop app (macOS and Windows): runs the server (../server.js) in the app's own Node and
// shows its page in a window. When a server already answers on the port (a source checkout run by install.sh),
// the window shows that one instead. Built into a .dmg and an .exe by scripts/release.sh.
const { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const MAC = process.platform === 'darwin';
const WIN = process.platform === 'win32';
const PORT = Number(process.env.BACKLOGS_PORT || 6400);
const HOME_URL = `http://localhost:${PORT}/`;

if (!app.requestSingleInstanceLock()) app.quit();

// A Mac app opened from the Finder gets a bare PATH: take the login shell's, where `backlog`, `claude` and `code` are.
if (MAC) {
	try {
		const shellPath = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 5000 });
		process.env.PATH = [...new Set([...shellPath.split(':'), ...(process.env.PATH || '').split(':')])].filter(Boolean).join(':');
	} catch (e) {}
}
// Tools shipped with the app (scripts/release.sh puts them in its resources).
if (app.isPackaged) {
	process.env.BACKLOG_BIN = path.join(process.resourcesPath, 'bin', WIN ? 'backlog.exe' : 'backlog');
	if (MAC) process.env.VAULT_BIN = path.join(process.resourcesPath, 'bin', 'backlogs-vault');
}

const listening = () => new Promise((resolve) => {
	const socket = net.connect(PORT, '127.0.0.1');
	socket.once('connect', () => (socket.destroy(), resolve(true)));
	socket.once('error', () => resolve(false));
});

// ---- settings: window bounds, open at login (first run: on) ----
const SETTINGS = path.join(app.getPath('userData'), 'settings.json');
const settings = (() => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (e) { return {}; } })();
const save = () => fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, '\t'));

let win, tray, server, quitting = false;

function createWindow() {
	const bounds = settings.bounds || { width: 1280, height: 820 };
	win = new BrowserWindow({
		...bounds,
		minWidth: 720,
		minHeight: 480,
		show: false,
		title: 'Backlog Hub',
		backgroundColor: '#f3f4f6',
		icon: WIN ? path.join(__dirname, 'icon.png') : undefined,
		// No title bar: the page's tab bar is the window's (-webkit-app-region in style.css). On a Mac the window
		// buttons sit on it, centred on the tabs; on Windows the system draws them over its right end.
		titleBarStyle: MAC ? 'hiddenInset' : 'hidden',
		trafficLightPosition: { x: 16, y: 27 },
		titleBarOverlay: WIN ? { color: '#f3f4f6', symbolColor: '#4b5563', height: 54 } : undefined,
		autoHideMenuBar: true,
		webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: true },
	});
	win.once('ready-to-show', () => !process.argv.includes('--hidden') && win.show());
	win.loadURL(HOME_URL);
	// The server not up yet: try again.
	win.webContents.on('did-fail-load', (event, code, description, url, mainFrame) => mainFrame && setTimeout(() => win.loadURL(HOME_URL), 1000));

	// The page's bar colour (its theme-color, set by the theme and palette) for the window and Windows' buttons.
	win.webContents.on('did-change-theme-color', (event, colour) => {
		if (!colour) return;
		win.setBackgroundColor(colour);
		if (WIN) {
			const dark = parseInt(colour.slice(1, 3), 16) < 128;
			win.setTitleBarOverlay({ color: colour, symbolColor: dark ? '#d1d5db' : '#4b5563' });
		}
	});
	const fullScreen = (on) => win.webContents.executeJavaScript(`document.documentElement.classList.toggle('fullscreen', ${on})`).catch(() => {});
	win.on('enter-full-screen', () => fullScreen(true));
	win.on('leave-full-screen', () => fullScreen(false));

	// Links outside localhost open in the default browser; the page and its boards never navigate away.
	const local = (url) => /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)|about:|data:|blob:)/.test(url);
	win.webContents.setWindowOpenHandler(({ url }) => {
		// The hub's own pages load in the window; anything else, a board or a local dev server included, in the browser.
		if (new URL(url).port === String(PORT) && local(url)) win.loadURL(url);
		else shell.openExternal(url);
		return { action: 'deny' };
	});
	// The window's page and its boards' iframes alike.
	win.webContents.on('will-frame-navigate', (event) => !local(event.url) && (event.preventDefault(), shell.openExternal(event.url)));

	const keep = () => !win.isFullScreen() && !win.isMinimized() && ((settings.bounds = win.getNormalBounds()), save());
	win.on('resized', keep);
	win.on('moved', keep);
	// Closing the window hides it: the page and its Claude conversations keep running (Dock icon or tray brings it back).
	win.on('close', (event) => {
		if (quitting) return;
		event.preventDefault();
		if (win.isFullScreen()) {
			win.once('leave-full-screen', () => win.hide());
			win.setFullScreen(false);
		} else win.hide();
	});
}

function show() {
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

function menu() {
	const atLogin = {
		label: 'Open at Login',
		type: 'checkbox',
		checked: app.getLoginItemSettings().openAtLogin,
		click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
	};
	const template = [
		...(MAC ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, atLogin, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
		{ role: 'editMenu' },
		{
			label: 'View',
			submenu: [
				{ label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => win.loadURL(HOME_URL) },
				{ role: 'reload' },
				{ role: 'toggleDevTools' },
				{ type: 'separator' },
				{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
			],
		},
		{ role: 'windowMenu' },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));

	// Windows: the tray icon brings back the hidden window and quits.
	if (WIN) {
		tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 }));
		tray.setToolTip('Backlog Hub');
		tray.on('click', show);
		tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show Backlog Hub', click: show }, atLogin, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
	}
}

app.on('second-instance', () => win && show());
app.on('activate', () => win && show());
app.on('before-quit', () => {
	quitting = true;
	server?.shutdown();
});

app.whenReady().then(async () => {
	// Installed (not a test build): open at login from the first run; the menu turns it off.
	if (settings.atLoginSet === undefined && app.isPackaged && (!MAC || app.isInApplicationsFolder())) {
		app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
		settings.atLoginSet = true;
		save();
	}
	// Our own server, unless one already answers (a source checkout's, run at login by install.sh).
	if (!(await listening())) {
		const platform = require('../platform');
		platform.hooks.open = (target) => (/^(https?|mailto):/i.test(target) ? shell.openExternal(target) : shell.openPath(target));
		platform.hooks.pickFolder = async () => {
			show();
			const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Add a project', message: 'Project folder (a board is created in it if it has none)', properties: ['openDirectory', 'createDirectory'] });
			return canceled ? null : filePaths[0];
		};
		server = require('../server');
		try {
			await server.ready;
		} catch (error) {
			dialog.showErrorBox('Backlog Hub', `The server could not start on port ${PORT}: ${error.message}`);
		}
	}
	menu();
	createWindow();
});
