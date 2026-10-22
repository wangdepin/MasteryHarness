/**
 * Unit tests — python-runner (protocol parsing, traceback shaping and the
 * generated documents; no browser, no Pyodide, no network).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildPythonRunnerDocument,
	buildPythonWorkerSource,
	normalizePyodideIndexUrl,
	parseRunnerReply,
	PYTHON_RUNNER_CHANNEL as CH,
	trimPythonTraceback,
} from "../src/core/python-runner.ts";

const INDEX = "https://cdn.example.com/pyodide/v1/full/";

describe("parseRunnerReply", () => {
	it("parses frame-ready, fatal and result", () => {
		assert.deepEqual(parseRunnerReply({ channel: CH, type: "frame-ready" }), { channel: CH, type: "frame-ready" });
		assert.deepEqual(parseRunnerReply({ channel: CH, type: "fatal", id: 3, message: "boom" }), {
			channel: CH,
			type: "fatal",
			id: 3,
			message: "boom",
		});
		assert.deepEqual(
			parseRunnerReply({ channel: CH, type: "result", id: 1, stdout: "hi\n", timedOut: false, durationMs: 4, passed: true }),
			{ channel: CH, type: "result", id: 1, stdout: "hi\n", timedOut: false, durationMs: 4, passed: true },
		);
	});

	it("drops undefined optional fields a structured clone leaves behind", () => {
		const reply = parseRunnerReply({
			channel: CH, type: "result", id: 1, stdout: "", timedOut: false, durationMs: 1, error: undefined, passed: undefined,
		});
		assert.ok(reply && reply.type === "result");
		assert.equal("error" in reply, false);
		assert.equal("passed" in reply, false);
	});

	it("ignores foreign and malformed messages", () => {
		assert.equal(parseRunnerReply(null), undefined);
		assert.equal(parseRunnerReply("x"), undefined);
		assert.equal(parseRunnerReply({ type: "frame-ready" }), undefined);
		assert.equal(parseRunnerReply({ channel: "other", type: "frame-ready" }), undefined);
		assert.equal(parseRunnerReply({ channel: CH, type: "result", id: 1 }), undefined);
		assert.equal(parseRunnerReply({ channel: CH, type: "result", stdout: "", timedOut: false, durationMs: 1 }), undefined);
		assert.equal(parseRunnerReply({ channel: CH, type: "nope", id: 1 }), undefined);
	});
});

describe("trimPythonTraceback", () => {
	it("drops Pyodide-internal frames and keeps the learner's", () => {
		const raw = [
			"Traceback (most recent call last):",
			'  File "/lib/python314.zip/_pyodide/_base.py", line 574, in eval_code_async',
			"    await CodeRunner(",
			'  File "/lib/python314.zip/_pyodide/_base.py", line 396, in run_async',
			"    coroutine = eval(self.code, globals, locals)",
			'  File "<code>", line 3, in <module>',
			'  File "<code>", line 2, in boom',
			"ZeroDivisionError: division by zero",
		].join("\n");
		assert.equal(
			trimPythonTraceback(raw),
			[
				"Traceback (most recent call last):",
				'  File "<code>", line 3, in <module>',
				'  File "<code>", line 2, in boom',
				"ZeroDivisionError: division by zero",
			].join("\n"),
		);
	});

	it("keeps <tests> frames and their source lines", () => {
		const raw = [
			"Traceback (most recent call last):",
			'  File "/lib/python314.zip/_pyodide/_base.py", line 1, in x',
			'  File "<tests>", line 1, in <module>',
			"    assert squares == [1]",
			"AssertionError",
		].join("\n");
		assert.equal(
			trimPythonTraceback(raw),
			['Traceback (most recent call last):', '  File "<tests>", line 1, in <module>', "    assert squares == [1]", "AssertionError"].join("\n"),
		);
	});

	it("keeps a SyntaxError block intact", () => {
		const raw = [
			"Traceback (most recent call last):",
			'  File "/lib/python314.zip/_pyodide/_base.py", line 1, in x',
			'  File "<code>", line 1',
			"    foo(",
			"       ^",
			"SyntaxError: '(' was never closed",
		].join("\n");
		assert.equal(
			trimPythonTraceback(raw),
			['Traceback (most recent call last):', '  File "<code>", line 1', "    foo(", "       ^", "SyntaxError: '(' was never closed"].join("\n"),
		);
	});

	it("passes text with no frames through", () => {
		assert.equal(trimPythonTraceback("Timed out after 5000 ms"), "Timed out after 5000 ms");
	});
});

describe("normalizePyodideIndexUrl", () => {
	it("adds the trailing slash", () => {
		assert.equal(normalizePyodideIndexUrl("https://cdn.example.com/pyodide/full"), "https://cdn.example.com/pyodide/full/");
		assert.equal(normalizePyodideIndexUrl(INDEX), INDEX);
	});

	it("rejects relative and non-http(s) URLs", () => {
		assert.throws(() => normalizePyodideIndexUrl("/pyodide/"), /absolute/);
		assert.throws(() => normalizePyodideIndexUrl("file:///pyodide/"), /http/);
		assert.throws(() => normalizePyodideIndexUrl("javascript:alert(1)"), /http/);
	});
});

describe("the generated documents", () => {
	it("worker source is a module importing pyodide.mjs from the index", () => {
		const source = buildPythonWorkerSource(INDEX);
		const [importLine, ...rest] = source.split("\n");
		assert.equal(importLine, `import { loadPyodide } from ${JSON.stringify(`${INDEX}pyodide.mjs`)};`);
		assert.doesNotThrow(() => new Function(rest.join("\n")), "the body is valid JavaScript");
		// scriptLiteral escapes "<" (as <) — the JS source still evaluates to "<code>".
		assert.ok(source.includes('"\\u003ccode>"') && source.includes('"\\u003ctests>"'));
	});

	it("runner document is a sandbox-safe page with one valid script", () => {
		const doc = buildPythonRunnerDocument(INDEX);
		const scripts = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)];
		assert.equal(scripts.length, 1);
		assert.equal(doc.split("</script>").length, 2, "no stray </script> from embedded strings");
		assert.doesNotThrow(() => new Function(scripts[0]![1]!));
		assert.ok(doc.includes(CH));
	});

	it("an index URL cannot break out of the script", () => {
		const doc = buildPythonRunnerDocument("https://evil.example/</script><script>alert(1)</script>/");
		assert.equal(doc.split("</script>").length, 2);
		assert.equal((doc.match(/<script>/g) ?? []).length, 1);
	});
});
