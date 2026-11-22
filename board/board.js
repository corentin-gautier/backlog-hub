// Added to every board's page by proxy.js (Backlog.md itself is a compiled binary).

// Theme: the board follows macOS. The saved choice is dropped before the page loads (proxy.js);
// when macOS switches, the board's own toggle is clicked so its state stays right.
(() => {
	const dark = matchMedia('(prefers-color-scheme: dark)');
	const sync = () => {
		if (document.documentElement.classList.contains('dark') !== dark.matches) document.querySelector('button[aria-label^="Switch to"]')?.click();
	};
	dark.addEventListener('change', sync);
	sync();
})();
