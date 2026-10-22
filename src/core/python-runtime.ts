/**
 * python-runtime — the host side of the Pyodide runner: a `CodeRuntime`
 * that talks to the sandboxed iframe (python-runner.ts) through an injected
 * transport. The transport is the only browser-specific piece (an iframe +
 * window messages, components/python-runtime-iframe.ts), so the request
 * correlation, queueing, watchdog and error mapping here run under test.
 *
 * `run` resolves for anything Python did (errors, failed asserts, timeouts
 * are results). It rejects with CodeRuntimeError only when the runtime
 * itself is unavailable: Pyodide failed to load, the frame went silent, or
 * the runtime was disposed.
 */

import type { CodeRunRequest, CodeRunResult, CodeRuntime } from "./code-exercise.ts";
import {
	PYTHON_RUNNER_CHANNEL,
	trimPythonTraceback,
	type RunnerReply,
	type RunnerRunMessage,
} from "./python-runner.ts";

/** The runtime itself failed — as opposed to the learner's code failing. */
export class CodeRuntimeError extends Error {
	override name = "CodeRuntimeError";
}

/** One live runner frame. */
export interface RunnerTransport {
	post(message: RunnerRunMessage): void;
	/** Deliver parsed replies from this frame; returns the unsubscribe. */
	subscribe(listener: (reply: RunnerReply) => void): () => void;
	/** Tear the frame down. */
	close(): void;
}

export interface PythonRuntimeOptions {
	/** Create a fresh frame. Called lazily on the first run, and again after a reset. */
	openTransport: () => RunnerTransport;
	/** How long past a run's own timeout (and for the frame to announce
	 *  itself) the host waits before declaring the frame dead. The first run
	 *  includes downloading Pyodide, so this is generous. Default 60 s. */
	watchdogGraceMs?: number;
}

export interface PythonRuntime extends CodeRuntime {
	language: "python";
	/** Tear the frame down and reject anything in flight. */
	dispose(): void;
}

interface Pending {
	resolve: (result: CodeRunResult) => void;
	reject: (error: CodeRuntimeError) => void;
	watchdog: ReturnType<typeof setTimeout>;
}

interface Session {
	transport: RunnerTransport;
	unsubscribe: () => void;
	ready: Promise<void>;
	markReady: () => void;
	failReady: (error: CodeRuntimeError) => void;
	readyWatchdog: ReturnType<typeof setTimeout>;
}

export function createPythonRuntime(options: PythonRuntimeOptions): PythonRuntime {
	const grace = options.watchdogGraceMs ?? 60_000;
	const pending = new Map<number, Pending>();
	let session: Session | null = null;
	let nextId = 0;

	function toResult(reply: Extract<RunnerReply, { type: "result" }>): CodeRunResult {
		return {
			stdout: reply.stdout,
			timedOut: reply.timedOut,
			durationMs: reply.durationMs,
			...(reply.error !== undefined ? { error: trimPythonTraceback(reply.error) } : {}),
			...(reply.passed !== undefined ? { passed: reply.passed } : {}),
		};
	}

	function onReply(reply: RunnerReply): void {
		if (reply.type === "frame-ready") {
			if (session) {
				clearTimeout(session.readyWatchdog);
				session.markReady();
			}
			return;
		}
		const entry = pending.get(reply.id);
		if (!entry) return;
		pending.delete(reply.id);
		clearTimeout(entry.watchdog);
		if (reply.type === "fatal") entry.reject(new CodeRuntimeError(reply.message));
		else entry.resolve(toResult(reply));
	}

	/** Close the frame and reject everything waiting on it. */
	function reset(error: CodeRuntimeError): void {
		const closing = session;
		session = null;
		if (closing) {
			clearTimeout(closing.readyWatchdog);
			closing.unsubscribe();
			closing.transport.close();
			closing.failReady(error);
		}
		for (const entry of pending.values()) {
			clearTimeout(entry.watchdog);
			entry.reject(error);
		}
		pending.clear();
	}

	function openSession(): Session {
		const transport = options.openTransport();
		let markReady!: () => void;
		let failReady!: (error: CodeRuntimeError) => void;
		const ready = new Promise<void>((resolve, reject) => {
			markReady = resolve;
			failReady = reject;
		});
		ready.catch(() => {}); // a reset with nobody waiting is not an unhandled rejection
		const opened: Session = {
			transport,
			unsubscribe: transport.subscribe(onReply),
			ready,
			markReady,
			failReady,
			readyWatchdog: setTimeout(
				() => reset(new CodeRuntimeError("The Python runtime frame never started.")),
				grace,
			),
		};
		return opened;
	}

	return {
		language: "python",

		async run(request: CodeRunRequest): Promise<CodeRunResult> {
			const current = (session ??= openSession());
			await current.ready;
			if (session !== current) throw new CodeRuntimeError("The Python runtime was reset.");
			return new Promise<CodeRunResult>((resolve, reject) => {
				const id = ++nextId;
				const watchdog = setTimeout(
					() => reset(new CodeRuntimeError("The Python runtime stopped responding.")),
					request.timeoutMs + grace,
				);
				pending.set(id, { resolve, reject, watchdog });
				current.transport.post({ channel: PYTHON_RUNNER_CHANNEL, type: "run", id, ...request });
			});
		},

		dispose(): void {
			reset(new CodeRuntimeError("The Python runtime was disposed."));
		},
	};
}
