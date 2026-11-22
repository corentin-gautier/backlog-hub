// Encrypted docs (vault.js on the server), driven from the doc pages of the boards (the Backlog.md fork):
// a board asks through postMessage; the request is taken only from a board's own frame, sent to the
// server for that board's project, and answered with the project's state. Uses `api` and `frames` from app.js.
const Vault = (() => {
	const ACTIONS = ['status', 'mark', 'unmark', 'unlock', 'lock'];

	addEventListener('message', async (event) => {
		const message = event.data;
		if (message?.backlogHub !== 'vault' || !ACTIONS.includes(message.do)) return;
		const port = Object.keys(frames).find((p) => frames[p].querySelector('iframe')?.contentWindow === event.source);
		if (!port) return;
		const state = message.do === 'status'
			? await api(`projects/${port}/vault`)
			: await api(`projects/${port}/vault`, 'POST', { do: message.do, id: message.id });
		if (state.error === 'Authentication cancelled') state.error = 'Unlock cancelled.';
		event.source.postMessage({ backlogHub: 'vault', seq: message.seq, state }, event.origin);
	});

	return { lock: (port) => api(`projects/${port}/vault`, 'POST', { do: 'lock' }) };
})();
