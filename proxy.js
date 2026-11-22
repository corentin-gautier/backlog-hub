// A proxy in front of each board, so the page can add to Backlog.md (a compiled binary) what it
// lacks: its HTML gets board/board.css and board/board.js, served by the proxy under /__backlogs/.
// Board on port P, proxy on P + OFFSET; WebSockets (live updates) pass through untouched.
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const OFFSET = 1000;
const DIR = path.join(__dirname, 'board');
const FILES = { '/__backlogs/board.js': 'text/javascript', '/__backlogs/board.css': 'text/css' };
// Before Backlog.md's own theme script: the saved theme is dropped, so the board follows macOS.
const HEAD = `<script>localStorage.removeItem('backlog-theme')</script><link rel="stylesheet" href="/__backlogs/board.css"><script src="/__backlogs/board.js" defer></script>`;
const proxies = new Map(); // board port -> server

function forward(target, req, res) {
	const headers = { ...req.headers, host: `localhost:${target}` };
	delete headers['accept-encoding']; // plain HTML, to inject into
	const out = http.request({ host: '127.0.0.1', port: target, method: req.method, path: req.url, headers }, (answer) => {
		if (!/text\/html/.test(answer.headers['content-type'] || '')) {
			res.writeHead(answer.statusCode, answer.headers);
			return answer.pipe(res);
		}
		const chunks = [];
		answer.on('data', (c) => chunks.push(c));
		answer.on('end', () => {
			const html = Buffer.concat(chunks).toString('utf8').replace(/<head>/i, (m) => m + HEAD);
			const head = { ...answer.headers, 'content-length': Buffer.byteLength(html), 'cache-control': 'no-cache' };
			delete head['transfer-encoding'];
			res.writeHead(answer.statusCode, head);
			res.end(html);
		});
	});
	out.on('error', () => (res.headersSent ? res.end() : (res.writeHead(502), res.end())));
	req.pipe(out);
}

function serve(req, res) {
	const type = FILES[req.url.split('?')[0]];
	res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
	fs.createReadStream(path.join(DIR, path.basename(req.url.split('?')[0]))).pipe(res);
}

// Raw upgrade: the request line and headers go as they came, then bytes both ways.
function tunnel(target, req, socket, head) {
	const upstream = net.connect(target, '127.0.0.1', () => {
		const lines = [`${req.method} ${req.url} HTTP/1.1`];
		for (let i = 0; i < req.rawHeaders.length; i += 2) {
			const [name, value] = [req.rawHeaders[i], req.rawHeaders[i + 1]];
			lines.push(`${name}: ${/^host$/i.test(name) ? `localhost:${target}` : value}`);
		}
		upstream.write(lines.join('\r\n') + '\r\n\r\n');
		if (head?.length) upstream.write(head);
		upstream.pipe(socket).pipe(upstream);
	});
	upstream.on('error', () => socket.destroy());
	socket.on('error', () => upstream.destroy());
}

// Starts the proxy of a board (once); resolves to its port.
function open(target) {
	const port = target + OFFSET;
	if (proxies.has(target)) return proxies.get(target);
	const ready = new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => (FILES[req.url.split('?')[0]] ? serve(req, res) : forward(target, req, res)));
		server.on('upgrade', (req, socket, head) => tunnel(target, req, socket, head));
		server.once('error', (error) => {
			proxies.delete(target);
			reject(error);
		});
		server.listen(port, '127.0.0.1', () => resolve(port));
	});
	proxies.set(target, ready);
	return ready;
}

module.exports = { open };
