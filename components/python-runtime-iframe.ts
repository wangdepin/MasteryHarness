import {
	buildPythonRunnerDocument,
	createPythonRuntime,
	parseRunnerReply,
	type PythonRuntime,
	type RunnerReply,
	type RunnerTransport,
} from "@/src/core";

/**
 * The browser transport for the Pyodide runner (python-runtime.ts): a
 * zero-size sandboxed iframe (sandbox="allow-scripts", no allow-same-origin
 * → opaque origin, the demo-card sandbox) holding the runner document.
 * Replies are accepted only from THIS iframe's window.
 */
export function openIframeTransport(pyodideIndexUrl: string): RunnerTransport {
	const iframe = document.createElement("iframe");
	iframe.setAttribute("sandbox", "allow-scripts");
	iframe.setAttribute("aria-hidden", "true");
	iframe.tabIndex = -1;
	iframe.style.cssText = "position:fixed;width:0;height:0;border:0;pointer-events:none;";
	iframe.srcdoc = buildPythonRunnerDocument(pyodideIndexUrl);

	const listeners = new Set<(reply: RunnerReply) => void>();
	const onMessage = (event: MessageEvent): void => {
		if (event.source !== iframe.contentWindow) return;
		const reply = parseRunnerReply(event.data);
		if (reply) for (const listener of listeners) listener(reply);
	};
	window.addEventListener("message", onMessage);
	document.body.appendChild(iframe);

	return {
		post: (message) => iframe.contentWindow?.postMessage(message, "*"),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close: () => {
			window.removeEventListener("message", onMessage);
			listeners.clear();
			iframe.remove();
		},
	};
}

/** A Python runtime backed by a sandboxed iframe. `pyodideIndexUrl` is the
 *  absolute URL of a Pyodide distribution directory. The iframe (and the
 *  ~10–20 MB Pyodide download) is created on the first run. */
export function createBrowserPythonRuntime(pyodideIndexUrl: string): PythonRuntime {
	return createPythonRuntime({ openTransport: () => openIframeTransport(pyodideIndexUrl) });
}
