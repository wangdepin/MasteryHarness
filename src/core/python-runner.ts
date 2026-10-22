/**
 * python-runner — the Pyodide runner's wire protocol and its sandboxed
 * document. Pure strings and parsers: no DOM, no network, unit-testable.
 *
 * Topology (the demo-card sandbox, components/artifacts/demo-card.tsx):
 *
 *   app page ──postMessage──▶ iframe sandbox="allow-scripts" (opaque origin)
 *                                 └─ module Web Worker (data: URL) running Pyodide
 *
 * The exercise code — the learner's AND the model-authored tests — never
 * shares the app's origin. The iframe's main thread stays free while Python
 * runs, so its timer can `terminate()` the Worker on an infinite loop.
 * Runs are serialized inside the iframe; each run gets a fresh Python
 * globals dict (imported modules persist until the Worker restarts).
 *
 * Why a module Worker from a data: URL (verified in Chrome, Pyodide 314):
 * Pyodide dropped classic-worker support, and inside an opaque-origin
 * iframe a module Worker cannot load from a blob: URL — a data: URL works.
 */

import type { CodeRunRequest } from "./code-exercise.ts";

/** Tags every message so unrelated postMessage traffic is ignored. */
export const PYTHON_RUNNER_CHANNEL = "lh-python-runner";

/** Cap on captured output per run — an unbounded `print` loop would
 *  otherwise flood memory before the timeout lands. */
export const PYTHON_MAX_STDOUT_CHARS = 50_000;

/** Filenames the runner gives the learner's code and the tests, so a
 *  traceback says which one failed. */
export const PYTHON_CODE_FILENAME = "<code>";
export const PYTHON_TESTS_FILENAME = "<tests>";

// ─── protocol ───────────────────────────────────────────────────────────────

/** Host → iframe. */
export interface RunnerRunMessage extends CodeRunRequest {
	channel: typeof PYTHON_RUNNER_CHANNEL;
	type: "run";
	id: number;
}

/** iframe → host. `frame-ready` fires as soon as the iframe's script is
 *  listening (before Pyodide loads); `fatal` means the runtime itself could
 *  not run request `id` (Pyodide failed to load, or the Worker crashed
 *  outside Python). `error` in a `result` is the raw Python traceback. */
export type RunnerReply =
	| { channel: typeof PYTHON_RUNNER_CHANNEL; type: "frame-ready" }
	| { channel: typeof PYTHON_RUNNER_CHANNEL; type: "fatal"; id: number; message: string }
	| {
			channel: typeof PYTHON_RUNNER_CHANNEL;
			type: "result";
			id: number;
			stdout: string;
			error?: string;
			passed?: boolean;
			timedOut: boolean;
			durationMs: number;
	  };

/** Parse an incoming window message from the iframe; undefined for anything
 *  that is not a well-formed runner reply. */
export function parseRunnerReply(data: unknown): RunnerReply | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const m = data as Record<string, unknown>;
	if (m.channel !== PYTHON_RUNNER_CHANNEL) return undefined;
	if (m.type === "frame-ready") return { channel: PYTHON_RUNNER_CHANNEL, type: "frame-ready" };
	if (typeof m.id !== "number") return undefined;
	if (m.type === "fatal") {
		const message = typeof m.message === "string" ? m.message : "unknown error";
		return { channel: PYTHON_RUNNER_CHANNEL, type: "fatal", id: m.id, message };
	}
	if (m.type !== "result") return undefined;
	if (typeof m.stdout !== "string" || typeof m.timedOut !== "boolean" || typeof m.durationMs !== "number") {
		return undefined;
	}
	return {
		channel: PYTHON_RUNNER_CHANNEL,
		type: "result",
		id: m.id,
		stdout: m.stdout,
		timedOut: m.timedOut,
		durationMs: m.durationMs,
		...(typeof m.error === "string" ? { error: m.error } : {}),
		...(typeof m.passed === "boolean" ? { passed: m.passed } : {}),
	};
}

// ─── traceback shaping ──────────────────────────────────────────────────────

const OWN_FILENAMES: ReadonlySet<string> = new Set([PYTHON_CODE_FILENAME, PYTHON_TESTS_FILENAME]);

/** Drop Pyodide-internal frames (`_pyodide/_base.py` …) from a traceback,
 *  keeping the learner's `<code>` frames, the `<tests>` frames, and the
 *  final exception line. */
export function trimPythonTraceback(raw: string): string {
	const out: string[] = [];
	let skipping = false;
	for (const line of raw.replace(/\r\n/g, "\n").trimEnd().split("\n")) {
		const frame = /^\s*File "([^"]*)", line \d+/.exec(line);
		if (frame) skipping = !OWN_FILENAMES.has(frame[1]!);
		else if (!/^\s/.test(line)) skipping = false;
		if (!skipping) out.push(line);
	}
	return out.join("\n");
}

// ─── the sandboxed document ─────────────────────────────────────────────────

/** Where Pyodide's files live. Must be absolute http(s): the iframe's
 *  origin is opaque, so a relative URL has nothing to resolve against. A
 *  trailing slash is added. */
export function normalizePyodideIndexUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Pyodide index URL must be absolute: "${url}"`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Pyodide index URL must be http(s): "${url}"`);
	}
	return parsed.href.endsWith("/") ? parsed.href : `${parsed.href}/`;
}

/** A JS string literal that is safe inside an inline <script>. */
function scriptLiteral(value: string): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** The Worker's source, an ES module. Streams stdout/stderr per line (so
 *  output survives a terminate on timeout; raw writes, so a partial line
 *  is not held back until the next newline), caps it, runs `code` then
 *  `tests` in one fresh globals dict, and reports the raw traceback on
 *  failure. */
export function buildPythonWorkerSource(indexUrl: string): string {
	return `import { loadPyodide } from ${scriptLiteral(`${indexUrl}pyodide.mjs`)};
var MAX = ${PYTHON_MAX_STDOUT_CHARS};
var current = 0, sent = 0, truncated = false;
function emit(text) {
	if (truncated) return;
	if (sent + text.length > MAX) {
		truncated = true;
		postMessage({ type: "out", id: current, text: text.slice(0, MAX - sent) + "\\n[output truncated]\\n" });
		return;
	}
	sent += text.length;
	postMessage({ type: "out", id: current, text: text });
}
var pyReady = loadPyodide({ indexURL: ${scriptLiteral(indexUrl)} }).then(function (py) {
	var decoder = new TextDecoder();
	var sink = { write: function (bytes) { emit(decoder.decode(bytes, { stream: true })); return bytes.length; } };
	py.setStdout(sink);
	py.setStderr(sink);
	py.setStdin({ error: true });
	postMessage({ type: "ready" });
	return py;
}).catch(function (err) {
	postMessage({ type: "load-error", message: String((err && err.message) || err) });
});
onmessage = async function (event) {
	var m = event.data;
	var py = await pyReady;
	if (!py) return;
	current = m.id; sent = 0; truncated = false;
	var ns = py.globals.get("dict")();
	var error, passed = m.tests === undefined ? undefined : true;
	try {
		await py.runPythonAsync(m.code, { globals: ns, filename: ${scriptLiteral(PYTHON_CODE_FILENAME)} });
		if (m.tests !== undefined) {
			await py.runPythonAsync(m.tests, { globals: ns, filename: ${scriptLiteral(PYTHON_TESTS_FILENAME)} });
		}
	} catch (err) {
		error = String((err && err.message) || err);
		if (m.tests !== undefined) passed = false;
	} finally {
		try { py.runPython("import sys; sys.stdout.flush(); sys.stderr.flush()"); } catch (e) {}
		ns.destroy();
	}
	postMessage({ type: "done", id: m.id, error: error, passed: passed });
};
`;
}

/** The iframe's srcdoc. Owns the Worker lifecycle: lazy start, serialized
 *  runs, timeout → terminate (the next run starts a fresh Worker). */
export function buildPythonRunnerDocument(pyodideIndexUrl: string): string {
	const workerSource = buildPythonWorkerSource(normalizePyodideIndexUrl(pyodideIndexUrl));
	return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>(function(){
var CH = ${scriptLiteral(PYTHON_RUNNER_CHANNEL)};
var WORKER_SOURCE = ${scriptLiteral(workerSource)};
var worker = null, ready = null;
function send(message) { message.channel = CH; parent.postMessage(message, "*"); }
function startWorker() {
	var w = new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(WORKER_SOURCE), { type: "module" });
	worker = w;
	ready = new Promise(function (resolve, reject) {
		w.onmessage = function (e) {
			if (e.data.type === "ready") resolve(w);
			else if (e.data.type === "load-error") reject(new Error("Pyodide failed to load: " + e.data.message));
		};
		w.onerror = function () { reject(new Error("Python worker failed to start (could not load Pyodide)")); };
	});
	ready.catch(function () { if (worker === w) { worker = null; w.terminate(); } });
}
function execute(w, m) {
	return new Promise(function (resolve) {
		var started = performance.now(), stdout = "", finished = false;
		function finish(extra) {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			w.onmessage = null; w.onerror = null;
			resolve(Object.assign({ type: "result", id: m.id, stdout: stdout, timedOut: false, durationMs: Math.round(performance.now() - started) }, extra));
		}
		var timer = setTimeout(function () {
			if (worker === w) worker = null;
			w.terminate();
			finish({ timedOut: true, error: "Timed out after " + m.timeoutMs + " ms", passed: m.tests === undefined ? undefined : false });
		}, m.timeoutMs);
		w.onmessage = function (e) {
			var d = e.data;
			if (d.id !== m.id) return;
			if (d.type === "out") stdout += d.text;
			else if (d.type === "done") finish({ error: d.error, passed: d.passed });
		};
		w.onerror = function (e) {
			if (worker === w) worker = null;
			w.terminate();
			finish({ error: "The Python worker crashed: " + (e.message || "unknown error"), passed: m.tests === undefined ? undefined : false });
		};
		w.postMessage({ id: m.id, code: m.code, tests: m.tests });
	});
}
function handleRun(m) {
	if (!worker) startWorker();
	return ready.then(
		function (w) { return execute(w, m).then(send); },
		function (err) { send({ type: "fatal", id: m.id, message: String(err.message || err) }); }
	);
}
var chain = Promise.resolve();
addEventListener("message", function (e) {
	var m = e.data;
	if (e.source !== parent || !m || m.channel !== CH || m.type !== "run") return;
	chain = chain.then(function () { return handleRun(m); });
});
send({ type: "frame-ready" });
})();</script></body></html>`;
}
