// Claude Code in each project: one terminal (a login shell running `claude`) per board,
// streamed to the page over a WebSocket. It keeps running while the page is closed
// and replays its recent output when the page reconnects.
const { execFile } = require('node:child_process');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');

const SHELL = process.env.SHELL || '/bin/zsh';
const KEEP = 256 * 1024; // output replayed on reconnect

const sessions = new Map(); // port -> { term, output, sockets }

function spawn(project, cols, rows) {
	// A login shell, so PATH and the rest come from the user's profile; the shell stays when claude exits.
	const term = pty.spawn(SHELL, ['-ilc', `claude; exec ${SHELL} -il`], {
		name: 'xterm-256color',
		cols,
		rows,
		cwd: project.dir,
		env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'en_US.UTF-8' },
	});
	const session = { term, output: '', sockets: new Set() };
	term.onData((data) => {
		session.output = (session.output + data).slice(-KEEP);
		for (const socket of session.sockets) socket.send(data);
	});
	term.onExit(() => {
		if (sessions.get(project.port) !== session) return;
		sessions.delete(project.port);
		for (const socket of session.sockets) socket.close(4000, 'exited');
	});
	sessions.set(project.port, session);
	return session;
}

function stop(port) {
	const session = sessions.get(port);
	if (!session) return;
	sessions.delete(port);
	session.term.kill();
	for (const socket of session.sockets) socket.close(4000, 'stopped');
}

// ws://localhost:PORT/claude/<board port>?cols=&rows=; only from the app's own page.
function attach(server, findProject, origins) {
	const wss = new WebSocketServer({ noServer: true });
	server.on('upgrade', (req, socket, head) => {
		const url = new URL(req.url, 'http://localhost');
		const project = findProject(url.pathname.split('/')[2]);
		if (!url.pathname.startsWith('/claude/') || !project || !origins.includes(req.headers.origin)) return socket.destroy();
		wss.handleUpgrade(req, socket, head, (ws) => {
			const size = (key, fallback) => Math.max(10, Number(url.searchParams.get(key)) || fallback);
			const session = sessions.get(project.port) || spawn(project, size('cols', 80), size('rows', 24));
			session.sockets.add(ws);
			if (session.output) ws.send(session.output);
			ws.on('message', (raw) => {
				const message = JSON.parse(raw);
				if (message.type === 'input') session.term.write(message.data);
				if (message.type === 'resize') session.term.resize(Math.max(10, message.cols), Math.max(5, message.rows));
			});
			ws.on('close', () => session.sockets.delete(ws));
		});
	});
}

// The same thing in Terminal.app.
function openInTerminal(dir) {
	const script = `on run argv
	tell application "Terminal"
		activate
		do script "cd " & quoted form of (item 1 of argv) & " && claude"
	end tell
end run`;
	execFile('osascript', ['-e', script, dir]);
}

module.exports = { attach, stop, openInTerminal, stopAll: () => [...sessions.keys()].forEach(stop) };
