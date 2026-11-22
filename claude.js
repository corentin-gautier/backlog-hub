// Claude in each project: one Claude Code conversation per board, run with the Agent SDK in the
// project folder and streamed to the page's chat over a WebSocket as simple events.
// The conversation keeps running while the page is closed, is replayed when the page reconnects,
// and is resumed from its transcript after a restart.
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const platform = require('./platform');

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
// { type: 'result', id, error, text, images? } { type: 'ask', id, name, input, title } { type: 'answered', id }
// { type: 'busy', value } { type: 'info', model, mode } { type: 'commands', list } { type: 'error', text } { type: 'reset', events, ...state }
// Subagents: an Agent tool call is a block; the tool and result events of its work carry `parent` (the
// Agent call's id); { type: 'agent', id, status?, text? } gives its end (completed, failed, stopped) and its report.

// A slash command as the transcript keeps it: <command-name>/x</command-name><command-args>y</command-args>.
const commandOf = (text) => {
	const name = (text.match(/<command-name>(.*?)<\/command-name>/) || [])[1];
	return name ? `${name.startsWith('/') ? name : `/${name}`} ${(text.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || ''}`.trim() : '';
};

// Images sent with a message, as the page shows them: data URLs.
const imagesOf = (content) => (Array.isArray(content) ? content : []).filter((b) => b.type === 'image' && b.source?.type === 'base64').map((b) => `data:${b.source.media_type};base64,${b.source.data}`);

const textOf = (content) => (typeof content === 'string' ? content : (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

// A subagent's own work, for its block: its tool calls and their results; its hand-back is its report.
function convertSub(message) {
	const parent = message.parent_tool_use_id;
	const content = message.message?.content;
	if (!Array.isArray(content)) return [];
	if (message.type === 'assistant') {
		return content.filter((b) => b.type === 'tool_use').map((b) => (b.name === 'SubagentHandback'
			? { type: 'agent', id: parent, text: String(b.input?.message || '') }
			: { type: 'tool', id: b.id, name: b.name, input: b.input, parent }));
	}
	return content.filter((b) => b.type === 'tool_result').map((b) => ({ type: 'result', id: b.tool_use_id, parent, error: Boolean(b.is_error), text: textOf(b.content).slice(0, 4000), ...(imagesOf(b.content).length ? { images: imagesOf(b.content) } : {}) }));
}

const DELIVERED = /report was delivered to you as a message/; // the report came as the agent's hand-back
const tag = (text, name) => (text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1];

// A background agent's end, as the transcript keeps it: <task-notification>…</task-notification>.
function notification(text) {
	const id = tag(text, 'tool-use-id');
	if (!id) return [];
	const result = (tag(text, 'result') || '').trim();
	return [{ type: 'agent', id, status: tag(text, 'status') || 'completed', ...(result && !DELIVERED.test(result) ? { text: result } : {}) }];
}

function convert(message) {
	if (message.parent_tool_use_id) return convertSub(message);
	const content = message.message?.content;
	if (message.origin?.kind === 'peer') return []; // a subagent's hand-back, shown in its block
	if (message.type === 'assistant') {
		return (content || []).flatMap((b) => {
			if (b.type === 'text' && b.text.trim()) return [{ type: 'text', text: b.text }];
			if (b.type === 'tool_use') return [{ type: 'tool', id: b.id, name: b.name, input: b.input }];
			return [];
		});
	}
	if (message.type === 'user') {
		if (typeof content === 'string') {
			if (content.startsWith('<task-notification>')) return notification(content);
			if (message.isSynthetic || content.startsWith('Another Claude session sent a message:')) return [];
			if (content.startsWith('<')) return commandOf(content) ? [{ type: 'user', text: commandOf(content) }] : [];
			return [{ type: 'user', text: content }];
		}
		const results = (content || []).filter((b) => b.type === 'tool_result');
		// An image the tool read (Read on a .png…) comes back as an image block: shown in the chat.
		if (results.length) return results.map((b) => ({ type: 'result', id: b.tool_use_id, error: Boolean(b.is_error), text: textOf(b.content).slice(0, 4000), ...(imagesOf(b.content).length ? { images: imagesOf(b.content) } : {}) }));
		const text = textOf(content);
		const images = imagesOf(content);
		if (message.isSynthetic || text.startsWith('<') || (!text && !images.length)) return [];
		return [{ type: 'user', text, ...(images.length ? { images } : {}) }];
	}
	return [];
}

// ---- one conversation ----

function create(project) {
	const chat = { project, sockets: new Set(), events: [], draft: '', busy: false, asks: new Map(), mode: null, model: '', choice: null, query: null, inbox: null, sessionId: remembered()[project.dir] || null };
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

// Before the first message: the default model, and the mode from the user's settings (as Claude Code would start).
const info = (chat) => ({ type: 'info', model: chat.model || models.find((m) => m.value === 'default')?.resolved || '', choice: chat.choice, mode: chat.mode, models });
async function startMode(chat) {
	if (chat.mode) return;
	const { resolveSettings, filterEscalatingDefaultMode } = await sdk;
	const settings = await resolveSettings({ cwd: chat.project.dir }).then(filterEscalatingDefaultMode).catch(() => ({}));
	const mode = settings.permissions?.defaultMode;
	chat.mode = chat.mode || (MODES.includes(mode) ? mode : 'default');
}
const snapshot = (chat) => ({ ...info(chat), type: 'reset', events: chat.events, draft: chat.draft, busy: chat.busy, sessionId: chat.sessionId, commands: commands.get(chat.project.dir) || [] });

// The models Claude Code offers (the same for every project), for the chat's model menu.
let models = [];
function setModels(list) {
	models = list.map((m) => ({ value: m.value, name: m.displayName, description: m.description, resolved: m.resolvedModel || m.value }));
}

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
	const q = query({ prompt: (async function* () { await new Promise(() => {}); })(), options: { cwd: chat.project.dir, systemPrompt: { type: 'preset', preset: 'claude_code' }, persistSession: false, pathToClaudeCodeExecutable: platform.claude(), stderr: () => {} } });
	try {
		setCommands(chat, await q.supportedCommands());
		if (!models.length) setModels(await q.supportedModels()), emit(chat, info(chat));
	} catch (error) {
		commands.delete(chat.project.dir);
	} finally {
		q.close();
	}
}

// The transcript of the remembered conversation, shown before anything is sent.
async function loadHistory(chat) {
	if (!chat.sessionId || chat.events.length) return;
	const { getSessionMessages, listSubagents, getSubagentMessages } = await sdk;
	const options = { dir: chat.project.dir };
	const messages = await getSessionMessages(chat.sessionId, options).catch(() => []);
	// Subagents keep their own transcripts: their work goes right after the Agent call it belongs to.
	const agents = await listSubagents(chat.sessionId, options).catch(() => []);
	const work = new Map(); // Agent call id -> its events
	for (const agent of agents) {
		for (const m of await getSubagentMessages(chat.sessionId, agent, options).catch(() => [])) {
			if (!m.parent_tool_use_id) continue;
			if (!work.has(m.parent_tool_use_id)) work.set(m.parent_tool_use_id, []);
			work.get(m.parent_tool_use_id).push(...convertSub(m));
		}
	}
	const withWork = (event) => [event, ...(event.type === 'tool' ? (work.get(event.id) || []).flatMap(withWork) : [])];
	chat.events = messages.flatMap(convert).flatMap(withWork);
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
			model: chat.choice || undefined, // else the default model
			canUseTool: canUseTool(chat),
			pathToClaudeCodeExecutable: platform.claude(), // the user's signed-in CLI; else the SDK's own
			stderr: () => {},
		},
	});
	chat.query = q;
	try {
		for await (const message of q) {
			if (chat.query !== q) break;
			// A turn Claude starts by itself (a background task or subagent finished): working again.
			if (!chat.busy && ['assistant', 'stream_event'].includes(message.type)) setBusy(chat, true);
			if (message.type === 'system' && message.subtype === 'init') {
				chat.model = message.model;
				chat.mode = message.permissionMode;
				if (chat.sessionId !== message.session_id) remember(chat.project.dir, (chat.sessionId = message.session_id));
				emit(chat, info(chat));
				q.supportedCommands().then((list) => setCommands(chat, list), () => {});
				q.supportedModels().then((list) => (setModels(list), emit(chat, info(chat))), () => {});
			} else if (message.type === 'system' && message.subtype === 'commands_changed') {
				setCommands(chat, message.commands);
			} else if (message.type === 'system' && message.subtype === 'task_notification' && message.tool_use_id) {
				// A subagent ended (a background one possibly long after its Agent call returned); its report came as its hand-back.
				emit(chat, { type: 'agent', id: message.tool_use_id, status: message.status });
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
	// A message, with images dropped or pasted in the composer (data URLs).
	send(chat, { text = '', images = [] }) {
		const blocks = images.map((url) => url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/)).filter(Boolean)
			.map(([, media_type, data]) => ({ type: 'image', source: { type: 'base64', media_type, data } }));
		if (!text.trim() && !blocks.length) return;
		emit(chat, { type: 'user', text, ...(blocks.length ? { images: imagesOf(blocks) } : {}) });
		setBusy(chat, true);
		if (!chat.inbox) run(chat);
		const content = blocks.length ? [...blocks, ...(text.trim() ? [{ type: 'text', text }] : [])] : text;
		chat.inbox.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
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
		emit(chat, info(chat));
	},
	// A model from the menu ('default' or null for the default one), for the next messages.
	async model(chat, { model }) {
		const found = models.find((m) => m.value === model);
		if (!found) return;
		chat.choice = model === 'default' ? null : model;
		chat.model = found.resolved;
		await chat.query?.setModel(chat.choice || undefined).catch(() => {});
		emit(chat, info(chat));
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
			await Promise.all([loadHistory(chat), startMode(chat)]);
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

// The same conversation in a terminal window.
function openInTerminal(project) {
	const id = chats.get(project.port)?.sessionId || remembered()[project.dir];
	platform.terminal(project.dir, id ? `--resume ${id}` : '');
}

module.exports = { attach, stop, sessions, openInTerminal, stopAll: () => [...chats.keys()].forEach(stop) };
