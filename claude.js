// Claude in each project: one Claude Code conversation per board, run with the Agent SDK in the
// project folder and streamed to the page's chat over a WebSocket as simple events.
// The conversation keeps running while the page is closed, is replayed when the page reconnects,
// and is resumed from its transcript after a restart.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { WebSocketServer } = require('ws');

const sdk = import('@anthropic-ai/claude-agent-sdk'); // ESM only
const MODES = ['default', 'acceptEdits', 'plan', 'auto'];

let store; // file holding the conversation of each project: { [dir]: sessionId }
const remembered = () => { try { return JSON.parse(fs.readFileSync(store, 'utf8')); } catch (e) { return {}; } };
function remember(dir, id) {
	const all = remembered();
	if (id) all[dir] = id; else delete all[dir];
	fs.writeFileSync(store, JSON.stringify(all, null, '\t') + '\n');
}

const chats = new Map(); // port -> chat

// ---- SDK messages -> page events ----
// { type: 'user', text } { type: 'text', text } { type: 'delta', text } { type: 'tool', id, name, input }
// { type: 'result', id, error, text } { type: 'ask', id, name, input, title } { type: 'answered', id }
// { type: 'busy', value } { type: 'info', model, mode } { type: 'commands', list } { type: 'error', text } { type: 'reset', events, ...state }

// A slash command as the transcript keeps it: <command-name>/x</command-name><command-args>y</command-args>.
const commandOf = (text) => {
	const name = (text.match(/<command-name>(.*?)<\/command-name>/) || [])[1];
	return name ? `${name.startsWith('/') ? name : `/${name}`} ${(text.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || ''}`.trim() : '';
};

const textOf = (content) => (typeof content === 'string' ? content : (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

function convert(message) {
	if (message.parent_tool_use_id) return []; // a subagent's own work
	const content = message.message?.content;
	if (message.type === 'assistant') {
		return (content || []).flatMap((b) => {
			if (b.type === 'text' && b.text.trim()) return [{ type: 'text', text: b.text }];
			if (b.type === 'tool_use') return [{ type: 'tool', id: b.id, name: b.name, input: b.input }];
			return [];
		});
	}
	if (message.type === 'user') {
		if (typeof content === 'string') {
			if (message.isSynthetic) return [];
			if (content.startsWith('<')) return commandOf(content) ? [{ type: 'user', text: commandOf(content) }] : [];
			return [{ type: 'user', text: content }];
		}
		const results = (content || []).filter((b) => b.type === 'tool_result');
		if (results.length) return results.map((b) => ({ type: 'result', id: b.tool_use_id, error: Boolean(b.is_error), text: textOf(b.content).slice(0, 4000) }));
		const text = textOf(content);
		return text && !message.isSynthetic && !text.startsWith('<') ? [{ type: 'user', text }] : [];
	}
	return [];
}

// ---- one conversation ----

function create(project) {
	const chat = { project, sockets: new Set(), events: [], draft: '', busy: false, asks: new Map(), mode: null, model: '', query: null, inbox: null, sessionId: remembered()[project.dir] || null };
	chats.set(project.port, chat);
	return chat;
}

function emit(chat, event) {
	if (event.type === 'delta') chat.draft += event.text;
	else if (!['busy', 'info', 'commands'].includes(event.type)) chat.events.push(event);
	if (event.type === 'text') chat.draft = '';
	const data = JSON.stringify(event);
	for (const socket of chat.sockets) if (socket.readyState === 1) socket.send(data);
}

function setBusy(chat, value) {
	chat.busy = value;
	if (!value) chat.draft = '';
	emit(chat, { type: 'busy', value });
}

const snapshot = (chat) => ({ type: 'reset', events: chat.events, draft: chat.draft, busy: chat.busy, mode: chat.mode, model: chat.model, sessionId: chat.sessionId, commands: commands.get(chat.project.dir) || [] });

// ---- slash commands ----
// The project's commands and skills, for the chat's / menu: from the running conversation, else
// from a short-lived one that only answers the list (~0.3 s).
const commands = new Map(); // dir -> [{ name, description, hint }]

function setCommands(chat, list) {
	const clean = list.filter((c) => !c.name.startsWith('_')).map((c) => ({ name: c.name, description: c.description, hint: c.argumentHint || '' }));
	commands.set(chat.project.dir, clean);
	emit(chat, { type: 'commands', list: clean });
}

async function loadCommands(chat) {
	if (commands.has(chat.project.dir)) return;
	commands.set(chat.project.dir, []);
	const { query } = await sdk;
	const q = query({ prompt: (async function* () { await new Promise(() => {}); })(), options: { cwd: chat.project.dir, systemPrompt: { type: 'preset', preset: 'claude_code' }, persistSession: false, stderr: () => {} } });
	try {
		setCommands(chat, await q.supportedCommands());
	} catch (error) {
		commands.delete(chat.project.dir);
	} finally {
		q.close();
	}
}

// The transcript of the remembered conversation, shown before anything is sent.
async function loadHistory(chat) {
	if (!chat.sessionId || chat.events.length) return;
	const { getSessionMessages } = await sdk;
	const messages = await getSessionMessages(chat.sessionId, { dir: chat.project.dir }).catch(() => []);
	chat.events = messages.flatMap(convert);
}

// Messages from the page, fed to the SDK as its streaming input.
function inbox() {
	const queue = [];
	let wake = null;
	return {
		push(message) { queue.push(message); wake?.(); },
		async *[Symbol.asyncIterator]() {
			for (;;) {
				while (queue.length) yield queue.shift();
				await new Promise((resolve) => (wake = resolve));
				wake = null;
			}
		},
	};
}

// Permission prompts and AskUserQuestion go to the page and wait for its answer.
function canUseTool(chat) {
	return (name, input, { signal, suggestions, title }) => new Promise((resolve) => {
		const id = Math.random().toString(36).slice(2);
		const done = (result) => {
			chat.asks.delete(id);
			emit(chat, { type: 'answered', id });
			resolve(result);
		};
		chat.asks.set(id, ({ choice, answers }) => {
			if (choice === 'deny') return done({ behavior: 'deny', message: 'The user declined.' });
			if (name === 'AskUserQuestion') return done({ behavior: 'allow', updatedInput: { ...input, answers } });
			done({ behavior: 'allow', updatedInput: input, ...(choice === 'always' && suggestions ? { updatedPermissions: suggestions } : {}) });
		});
		signal.addEventListener('abort', () => chat.asks.has(id) && done({ behavior: 'deny', message: 'Interrupted.' }));
		emit(chat, { type: 'ask', id, name, input, title });
	});
}

async function run(chat) {
	chat.inbox = inbox(); // before any await: send() pushes to it right away
	const { query } = await sdk;
	const q = query({
		prompt: chat.inbox,
		options: {
			cwd: chat.project.dir,
			resume: chat.sessionId || undefined,
			systemPrompt: { type: 'preset', preset: 'claude_code' },
			includePartialMessages: true,
			permissionMode: chat.mode || undefined, // else the user's settings decide
			canUseTool: canUseTool(chat),
			stderr: () => {},
		},
	});
	chat.query = q;
	try {
		for await (const message of q) {
			if (chat.query !== q) break;
			if (message.type === 'system' && message.subtype === 'init') {
				chat.model = message.model;
				chat.mode = message.permissionMode;
				if (chat.sessionId !== message.session_id) remember(chat.project.dir, (chat.sessionId = message.session_id));
				emit(chat, { type: 'info', model: chat.model, mode: chat.mode });
				q.supportedCommands().then((list) => setCommands(chat, list), () => {});
			} else if (message.type === 'system' && message.subtype === 'commands_changed') {
				setCommands(chat, message.commands);
			} else if (message.type === 'stream_event' && !message.parent_tool_use_id) {
				const { event } = message;
				if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') emit(chat, { type: 'delta', text: event.delta.text });
			} else if (message.type === 'result') {
				if (message.subtype !== 'success' && !chat.interrupted) emit(chat, { type: 'error', text: (message.errors || []).join('\n') || message.subtype });
				chat.interrupted = false;
				setBusy(chat, false);
			} else if (message.type === 'assistant' || message.type === 'user') {
				for (const event of convert(message)) if (event.type !== 'user') emit(chat, event);
			}
		}
	} catch (error) {
		if (chat.query === q) emit(chat, { type: 'error', text: error.message });
	}
	if (chat.query === q) {
		chat.query = null;
		chat.inbox = null;
		setBusy(chat, false);
	}
}

function close(chat) {
	chat.query?.close();
	chat.query = null;
	chat.inbox = null;
	for (const answer of chat.asks.values()) answer({ choice: 'deny' });
}

const actions = {
	send(chat, { text }) {
		if (!text?.trim()) return;
		emit(chat, { type: 'user', text });
		setBusy(chat, true);
		if (!chat.inbox) run(chat);
		chat.inbox.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
	},
	answer(chat, { id, choice, answers }) {
		chat.asks.get(id)?.({ choice, answers });
	},
	stop(chat) {
		chat.interrupted = true;
		chat.query?.interrupt().catch(() => {});
	},
	async mode(chat, { mode }) {
		if (!MODES.includes(mode)) return;
		chat.mode = mode;
		await chat.query?.setPermissionMode(mode).catch(() => {});
		emit(chat, { type: 'info', model: chat.model, mode });
	},
	// A new conversation, or an earlier one (sessionId) from the history.
	async open(chat, { sessionId }) {
		close(chat);
		chat.events = [];
		chat.sessionId = sessionId || null;
		remember(chat.project.dir, chat.sessionId);
		await loadHistory(chat);
		setBusy(chat, false);
		const data = JSON.stringify(snapshot(chat));
		for (const socket of chat.sockets) socket.send(data);
	},
};

// ---- server side ----

// The project's earlier conversations, newest first.
async function sessions(project) {
	const { listSessions } = await sdk;
	const list = await listSessions({ dir: project.dir, limit: 40 }).catch(() => []);
	return list.map((s) => ({ id: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || '…', at: s.lastModified }));
}

function stop(port) {
	const chat = chats.get(port);
	if (!chat) return;
	close(chat);
	chats.delete(port);
	for (const socket of chat.sockets) socket.close(4000, 'stopped');
}

// ws://localhost:PORT/claude/<board port>; only from the app's own page.
function attach(server, findProject, origins, dataDir) {
	store = path.join(dataDir, 'claude.json');
	const wss = new WebSocketServer({ noServer: true });
	server.on('upgrade', (req, socket, head) => {
		const url = new URL(req.url, 'http://localhost');
		const project = findProject(url.pathname.split('/')[2]);
		if (!url.pathname.startsWith('/claude/') || !project || !origins.includes(req.headers.origin)) return socket.destroy();
		wss.handleUpgrade(req, socket, head, async (ws) => {
			const chat = chats.get(project.port) || create(project);
			await loadHistory(chat);
			chat.sockets.add(ws);
			ws.send(JSON.stringify(snapshot(chat)));
			loadCommands(chat).catch(() => {});
			ws.on('message', (raw) => {
				let message;
				try { message = JSON.parse(raw); } catch (e) { return; }
				(async () => actions[message.type]?.(chat, message))().catch((error) => emit(chat, { type: 'error', text: error.message }));
			});
			ws.on('close', () => chat.sockets.delete(ws));
		});
	});
}

// The same conversation in Terminal.app.
function openInTerminal(project) {
	const id = chats.get(project.port)?.sessionId || remembered()[project.dir];
	const script = `on run argv
	tell application "Terminal"
		activate
		do script "cd " & quoted form of (item 1 of argv) & " && claude" & (item 2 of argv)
	end tell
end run`;
	execFile('osascript', ['-e', script, project.dir, id ? ` --resume ${id}` : '']);
}

module.exports = { attach, stop, sessions, openInTerminal, stopAll: () => [...chats.keys()].forEach(stop) };
