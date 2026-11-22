// Backlog Hub as a Mac app: a window showing the local server's page (http://localhost:6400) in a WebKit view.
// Built by scripts/build-app.sh. The server itself runs from the launchd agent set up by install.sh.
import Cocoa
import WebKit

let home = URL(string: "http://localhost:6400/")!

// Remembers the last click so a drag started by the page (on an empty spot of the tab bar) can move the window.
final class WebView: WKWebView {
	var lastMouseDown: NSEvent?
	override func mouseDown(with event: NSEvent) {
		lastMouseDown = event
		super.mouseDown(with: event)
	}
	override var mouseDownCanMoveWindow: Bool { false }
}

// The window's close, minimize and zoom buttons, out of the title bar: the system's title bar (even transparent)
// catches drags in the top of the window, which breaks dragging tabs to reorder them. So it is hidden and the
// buttons live here, centred on the tab bar. `_mouseInGroup:` is what AppKit asks to show their glyphs on hover.
final class WindowButtons: NSView {
	var inside = false { didSet { subviews.forEach { $0.needsDisplay = true } } }
	init(window: NSWindow) {
		super.init(frame: NSRect(x: 0, y: 0, width: 66, height: 16))
		for (i, type) in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].enumerated() {
			guard let button = NSWindow.standardWindowButton(type, for: window.styleMask) else { continue }
			button.setFrameOrigin(NSPoint(x: i * 20, y: 0))
			addSubview(button)
		}
		addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways], owner: self))
	}
	required init?(coder: NSCoder) { nil }
	override func mouseEntered(with event: NSEvent) { inside = true }
	override func mouseExited(with event: NSEvent) { inside = false }
	@objc func _mouseInGroup(_ button: NSButton) -> Bool { inside }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
	var window: NSWindow!
	var web: WebView!
	var buttons: WindowButtons!

	func applicationDidFinishLaunching(_ notification: Notification) {
		buildMenu()

		let config = WKWebViewConfiguration()
		config.preferences.isElementFullscreenEnabled = true
		// Tells the page it runs in the app (style.css makes room for the window buttons) and lets the
		// tab bar's empty spots move the window, as -webkit-app-region does in an installed web app.
		let script = """
		document.documentElement.classList.add('mac-app');
		const empty = (e) => e.target.closest('nav') && !e.target.closest('button, a, input, textarea, select, [contenteditable]');
		addEventListener('mousedown', (e) => { if (e.button === 0 && e.detail === 1 && empty(e)) webkit.messageHandlers.app.postMessage('drag'); });
		addEventListener('dblclick', (e) => { if (empty(e)) webkit.messageHandlers.app.postMessage('zoom'); });
		"""
		config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
		config.userContentController.add(self, name: "app")

		web = WebView(frame: .zero, configuration: config)
		web.navigationDelegate = self
		web.uiDelegate = self
		web.isInspectable = true
		web.allowsMagnification = true
		web.setValue(false, forKey: "drawsBackground") // no white flash before the page paints

		window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
			styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
			backing: .buffered, defer: false)
		window.title = "Backlog Hub"
		window.titleVisibility = .hidden
		window.titlebarAppearsTransparent = true
		window.minSize = NSSize(width: 720, height: 480)
		// The page fills the window; the window's buttons sit over it, 25pt from the top (centred on the tabs).
		let content = NSView()
		web.frame = content.bounds
		web.autoresizingMask = [.width, .height]
		content.addSubview(web)
		buttons = WindowButtons(window: window)
		buttons.autoresizingMask = [.maxXMargin, .minYMargin]
		content.addSubview(buttons)
		window.contentView = content
		placeButtons()
		window.delegate = self
		window.center()
		window.setFrameAutosaveName("main")
		window.makeKeyAndOrderFront(nil)

		web.load(URLRequest(url: home))
	}

	// Closing the window hides it: the page and its Claude conversations stay loaded. The Dock icon brings it back.
	func windowShouldClose(_ sender: NSWindow) -> Bool {
		window.orderOut(nil)
		return false
	}
	func placeButtons() {
		window.standardWindowButton(.closeButton)?.superview?.superview?.isHidden = true // the system's title bar
		buttons.setFrameOrigin(NSPoint(x: 13, y: window.contentView!.bounds.height - 25 - 16))
	}
	func windowDidResize(_ notification: Notification) { placeButtons() }

	// Full screen hides the window's buttons: the bar takes its left end back.
	func windowDidEnterFullScreen(_ notification: Notification) {
		buttons.isHidden = true
		web.evaluateJavaScript("document.documentElement.classList.add('fullscreen')")
	}
	func windowDidExitFullScreen(_ notification: Notification) {
		buttons.isHidden = false
		placeButtons()
		web.evaluateJavaScript("document.documentElement.classList.remove('fullscreen')")
	}
	func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
		window.makeKeyAndOrderFront(nil)
		return true
	}

	func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
		switch message.body as? String {
		case "drag": if let event = web.lastMouseDown { window.performDrag(with: event) }
		case "zoom": UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") == "Minimize" ? window.miniaturize(nil) : window.zoom(nil)
		default: break
		}
	}

	// ---- navigation: the hub and its boards (localhost) stay in the app; anything else opens in the browser ----
	func isLocal(_ url: URL?) -> Bool { ["localhost", "127.0.0.1"].contains(url?.host ?? "") || url?.scheme == "about" || url?.scheme == "data" || url?.scheme == "blob" }

	func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
		if let url = action.request.url, !isLocal(url), action.targetFrame?.isMainFrame ?? true {
			NSWorkspace.shared.open(url)
			return decisionHandler(.cancel)
		}
		decisionHandler(.allow)
	}

	// target="_blank" and window.open: the browser for outside links, the app's own window otherwise.
	func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
		if let url = action.request.url {
			if isLocal(url) { webView.load(URLRequest(url: url)) } else { NSWorkspace.shared.open(url) }
		}
		return nil
	}

	// The server is not up yet (just after login): try again.
	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
		DispatchQueue.main.asyncAfter(deadline: .now() + 1) { webView.load(URLRequest(url: home)) }
	}
	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

	// ---- alert, confirm, prompt and file pickers, which a web view leaves to the app ----
	func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
		let alert = NSAlert()
		alert.messageText = message
		alert.beginSheetModal(for: window) { _ in completionHandler() }
	}
	func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
		let alert = NSAlert()
		alert.messageText = message
		alert.addButton(withTitle: "OK")
		alert.addButton(withTitle: "Cancel")
		alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
	}
	func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
		let alert = NSAlert()
		alert.messageText = prompt
		alert.addButton(withTitle: "OK")
		alert.addButton(withTitle: "Cancel")
		let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
		field.stringValue = defaultText ?? ""
		alert.accessoryView = field
		alert.window.initialFirstResponder = field
		alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
	}
	func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
		let panel = NSOpenPanel()
		panel.allowsMultipleSelection = parameters.allowsMultipleSelection
		panel.canChooseDirectories = parameters.allowsDirectories
		panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
	}

	// ---- menus ----
	@objc func reload() { web.reload() }
	@objc func goHome() { web.load(URLRequest(url: home)) }
	@objc func zoomIn() { web.pageZoom = min(web.pageZoom + 0.1, 3) }
	@objc func zoomOut() { web.pageZoom = max(web.pageZoom - 0.1, 0.5) }
	@objc func actualSize() { web.pageZoom = 1 }
	@objc func showWindow() { window.makeKeyAndOrderFront(nil) }

	func buildMenu() {
		let main = NSMenu()
		func menu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
			let item = NSMenuItem()
			let sub = NSMenu(title: title)
			items.forEach(sub.addItem)
			item.submenu = sub
			main.addItem(item)
			return sub
		}
		func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
			let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
			i.keyEquivalentModifierMask = mods
			return i
		}
		_ = menu("Backlog Hub", [
			item("About Backlog Hub", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
			.separator(),
			item("Hide Backlog Hub", #selector(NSApplication.hide(_:)), "h"),
			item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
			item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
			.separator(),
			item("Quit Backlog Hub", #selector(NSApplication.terminate(_:)), "q"),
		])
		_ = menu("Edit", [
			item("Undo", Selector(("undo:")), "z"),
			item("Redo", Selector(("redo:")), "z", [.command, .shift]),
			.separator(),
			item("Cut", #selector(NSText.cut(_:)), "x"),
			item("Copy", #selector(NSText.copy(_:)), "c"),
			item("Paste", #selector(NSText.paste(_:)), "v"),
			item("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift]),
			item("Select All", #selector(NSText.selectAll(_:)), "a"),
		])
		_ = menu("View", [
			item("Home", #selector(goHome), "H", [.command, .shift]),
			item("Reload", #selector(reload), "r"),
			.separator(),
			item("Actual Size", #selector(actualSize), "0"),
			item("Zoom In", #selector(zoomIn), "+"),
			item("Zoom Out", #selector(zoomOut), "-"),
			.separator(),
			item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
		])
		let windows = menu("Window", [
			item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
			item("Zoom", #selector(NSWindow.performZoom(_:))),
			item("Close", #selector(NSWindow.performClose(_:)), "w"),
			.separator(),
			item("Backlog Hub", #selector(showWindow), "0", [.command, .option]),
		])
		NSApp.mainMenu = main
		NSApp.windowsMenu = windows
	}
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
