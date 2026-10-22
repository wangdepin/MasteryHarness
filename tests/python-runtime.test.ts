/**
 * Unit tests — python-runtime (the host side, against a fake transport).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodeRuntimeError, createPythonRuntime, type RunnerTransport } from "../src/core/python-runtime.ts";
import { PYTHON_RUNNER_CHANNEL as CH, type RunnerReply, type RunnerRunMessage } from "../src/core/python-runner.ts";

/** A reply without its channel tag (distributed over the union). */
type ReplyBody = RunnerReply extends infer R ? (R extends RunnerReply ? Omit<R, "channel"> : never) : never;

/** A transport the test drives by hand. */
function fakeTransport() {
	const posted: RunnerRunMessage[] = [];
	const listeners = new Set<(reply: RunnerReply) => void>();
	let closed = false;
	const transport: RunnerTransport = {
		post: (message) => void posted.push(message),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close: () => {
			closed = true;
		},
	};
	const reply = (r: ReplyBody) => {
		for (const listener of listeners) listener({ channel: CH, ...r } as RunnerReply);
	};
	return { transport, posted, reply, isClosed: () => closed, listenerCount: () => listeners.size };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const request = { code: "print(1)", timeoutMs: 1000 };

describe("createPythonRuntime", () => {
	it("opens the frame lazily and posts only after frame-ready", async () => {
		const frame = fakeTransport();
		let opened = 0;
		const runtime = createPythonRuntime({ openTransport: () => (opened++, frame.transport) });
		assert.equal(opened, 0);
		const run = runtime.run(request);
		await tick();
		assert.equal(opened, 1);
		assert.equal(frame.posted.length, 0);
		frame.reply({ type: "frame-ready" });
		await tick();
		assert.equal(frame.posted.length, 1);
		assert.equal(frame.posted[0]!.code, "print(1)");
		frame.reply({ type: "result", id: frame.posted[0]!.id, stdout: "1\n", timedOut: false, durationMs: 7 });
		assert.deepEqual(await run, { stdout: "1\n", timedOut: false, durationMs: 7 });
		runtime.dispose();
	});

	it("reuses one frame and correlates results by id", async () => {
		const frame = fakeTransport();
		let opened = 0;
		const runtime = createPythonRuntime({ openTransport: () => (opened++, frame.transport) });
		const a = runtime.run({ ...request, code: "a" });
		const b = runtime.run({ ...request, code: "b" });
		frame.reply({ type: "frame-ready" });
		await tick();
		assert.equal(opened, 1);
		assert.equal(frame.posted.length, 2);
		const [first, second] = frame.posted as [RunnerRunMessage, RunnerRunMessage];
		assert.notEqual(first.id, second.id);
		frame.reply({ type: "result", id: second.id, stdout: "B", timedOut: false, durationMs: 1 });
		frame.reply({ type: "result", id: first.id, stdout: "A", timedOut: false, durationMs: 1 });
		assert.equal((await a).stdout, "A");
		assert.equal((await b).stdout, "B");
		runtime.dispose();
	});

	it("trims Pyodide-internal frames and carries passed/error through", async () => {
		const frame = fakeTransport();
		const runtime = createPythonRuntime({ openTransport: () => frame.transport });
		const run = runtime.run({ ...request, tests: "assert False" });
		frame.reply({ type: "frame-ready" });
		await tick();
		const error = [
			"Traceback (most recent call last):",
			'  File "/lib/python314.zip/_pyodide/_base.py", line 1, in x',
			'  File "<tests>", line 1, in <module>',
			"AssertionError",
		].join("\n");
		frame.reply({ type: "result", id: frame.posted[0]!.id, stdout: "", error, passed: false, timedOut: false, durationMs: 2 });
		const result = await run;
		assert.equal(result.passed, false);
		assert.equal(result.error, ['Traceback (most recent call last):', '  File "<tests>", line 1, in <module>', "AssertionError"].join("\n"));
		runtime.dispose();
	});

	it("rejects only the affected run on fatal", async () => {
		const frame = fakeTransport();
		const runtime = createPythonRuntime({ openTransport: () => frame.transport });
		const a = runtime.run(request);
		const b = runtime.run(request);
		frame.reply({ type: "frame-ready" });
		await tick();
		const [first, second] = frame.posted as [RunnerRunMessage, RunnerRunMessage];
		frame.reply({ type: "fatal", id: first.id, message: "Pyodide failed to load: offline" });
		frame.reply({ type: "result", id: second.id, stdout: "ok", timedOut: false, durationMs: 1 });
		await assert.rejects(a, (error) => error instanceof CodeRuntimeError && /offline/.test(error.message));
		assert.equal((await b).stdout, "ok");
		runtime.dispose();
	});

	it("ignores replies for unknown ids", async () => {
		const frame = fakeTransport();
		const runtime = createPythonRuntime({ openTransport: () => frame.transport });
		const run = runtime.run(request);
		frame.reply({ type: "frame-ready" });
		await tick();
		frame.reply({ type: "result", id: 999, stdout: "stray", timedOut: false, durationMs: 1 });
		frame.reply({ type: "result", id: frame.posted[0]!.id, stdout: "real", timedOut: false, durationMs: 1 });
		assert.equal((await run).stdout, "real");
		runtime.dispose();
	});

	it("resets a silent frame: rejects in-flight runs and reopens on the next run", async () => {
		const frames = [fakeTransport(), fakeTransport()];
		let opened = 0;
		const runtime = createPythonRuntime({ openTransport: () => frames[opened++]!.transport, watchdogGraceMs: 20 });
		const stuck = runtime.run({ ...request, timeoutMs: 10 });
		frames[0]!.reply({ type: "frame-ready" });
		await assert.rejects(stuck, (error) => error instanceof CodeRuntimeError && /stopped responding/.test(error.message));
		assert.equal(frames[0]!.isClosed(), true);
		assert.equal(frames[0]!.listenerCount(), 0);

		const next = runtime.run(request);
		await tick();
		assert.equal(opened, 2);
		frames[1]!.reply({ type: "frame-ready" });
		await tick();
		frames[1]!.reply({ type: "result", id: frames[1]!.posted[0]!.id, stdout: "back", timedOut: false, durationMs: 1 });
		assert.equal((await next).stdout, "back");
		runtime.dispose();
	});

	it("gives up on a frame that never announces itself", async () => {
		const frame = fakeTransport();
		const runtime = createPythonRuntime({ openTransport: () => frame.transport, watchdogGraceMs: 20 });
		await assert.rejects(runtime.run(request), (error) => error instanceof CodeRuntimeError && /never started/.test(error.message));
		assert.equal(frame.isClosed(), true);
	});

	it("dispose rejects in-flight runs and closes the frame", async () => {
		const frame = fakeTransport();
		const runtime = createPythonRuntime({ openTransport: () => frame.transport });
		const run = runtime.run(request);
		frame.reply({ type: "frame-ready" });
		await tick();
		runtime.dispose();
		await assert.rejects(run, CodeRuntimeError);
		assert.equal(frame.isClosed(), true);
	});
});
