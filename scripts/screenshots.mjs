// Takes the README's screenshots of the page served on the given port, with headless Chrome (DevTools protocol).
// Run by scripts/screenshots.sh, which sets up the demo projects.
//   node scripts/screenshots.mjs <port> <folder>
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [port, folder] = process.argv.slice(2);
const url = `http://localhost:${port}/`;
const profile = mkdtempSync(path.join(tmpdir(), 'shots-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--remote-debugging-port=9335', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 40 && !page; i++) {
	await sleep(250);
	page = await fetch('http://127.0.0.1:9335/json').then((r) => r.json()).then((list) => list.find((t) => t.type === 'page')).catch(() => null);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = {};
ws.onmessage = (e) => { const m = JSON.parse(e.data); waiting[m.id]?.(m.result); };
const send = (method, params = {}) => new Promise((r) => { waiting[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
const run = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true });

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url });
await sleep(1000);

// A shot after setting the palette, theme and open tabs (localStorage, as the page keeps them), then a reload.
async function shot(name, { palette, theme, open = [], tab = '', then = '' }) {
	await run(`localStorage.clear(); Object.entries(${JSON.stringify({ palette, theme, open, tab })}).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)))`);
	await send('Page.reload');
	await sleep(tab ? 6000 : 2500); // a board starts on its first opening
	if (then) await run(then), await sleep(2500);
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, 'base64'));
	console.log(`${folder}/${name}.png`);
}

const tabs = ['6491', '6492', '6493'];
await shot('home', { palette: 'default', theme: 'light', open: tabs });
await shot('home-dark', { palette: 'default', theme: 'dark', open: tabs });
await shot('board', { palette: 'default', theme: 'light', open: tabs, tab: '6491', then: `document.querySelector('#claude').click()` });

chrome.kill();
await new Promise((r) => chrome.once('exit', r));
rmSync(profile, { recursive: true, force: true });
process.exit(0);
