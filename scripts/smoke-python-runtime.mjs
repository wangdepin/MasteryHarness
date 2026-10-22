/**
 * Drive the REAL Python runner end to end in system Chrome: the bundled
 * iframe glue (components/python-runtime-iframe.ts) → sandbox="allow-scripts"
 * iframe → module Worker → Pyodide. Not part of `npm test`: it needs
 * network (unless --index points at a local Pyodide) and a Chrome install.
 *
 *   node scripts/smoke-python-runtime.mjs [--index <Pyodide dir URL>] [--chrome <path>]
 *
 * Defaults: the pinned jsDelivr Pyodide below; CHROME_PATH or the macOS
 * Google Chrome. esbuild comes with tsx (the repo's script runner).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(`${repo}package.json`);
const esbuild = require("esbuild");
const puppeteer = require("puppeteer-core");

const argument = (name) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? undefined : process.argv[at + 1];
};
const INDEX = argument("--index") ?? "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const CHROME = argument("--chrome") ?? process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// `node:crypto` rides in through the core barrel (coverage.ts) and is never called in the browser.
const cryptoStub = "export const createHash = () => { throw new Error('node:crypto is not available in the browser'); };";
const bundle = (await esbuild.build({
	stdin: {
		contents: `import { createBrowserPythonRuntime } from "./components/python-runtime-iframe.ts";
window.__runtime = createBrowserPythonRuntime(${JSON.stringify(INDEX)});`,
		resolveDir: repo,
		loader: "ts",
	},
	bundle: true,
	format: "iife",
	write: false,
	tsconfig: `${repo}tsconfig.json`,
	plugins: [
		{
			name: "stub-node-crypto",
			setup: (build) => {
				build.onResolve({ filter: /^node:crypto$/ }, () => ({ path: "node:crypto", namespace: "stub" }));
				build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: cryptoStub, loader: "js" }));
			},
		},
	],
	logLevel: "error",
})).outputFiles[0].text;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
	const page = await browser.newPage();
	page.on("pageerror", (error) => console.log("[pageerror]", String(error)));
	await page.goto("about:blank");
	await page.addScriptTag({ content: bundle });

	/** Run one request in the page; a runtime rejection comes back as `{ rejected }`. */
	const run = (request) =>
		page.evaluate(async (req) => {
			try {
				return await window.__runtime.run(req);
			} catch (error) {
				return { rejected: String(error) };
			}
		}, request);

	const cases = [
		["prints (first run downloads Pyodide)", { code: 'print("hi")', timeoutMs: 120_000 }, (r) => assert.equal(r.stdout, "hi\n")],
		["keeps output without a trailing newline", { code: 'print("a", end="")', timeoutMs: 10_000 }, (r) => assert.equal(r.stdout, "a")],
		["does not leak it into the next run", { code: 'print("b")', timeoutMs: 10_000 }, (r) => assert.equal(r.stdout, "b\n")],
		["captures stderr", { code: 'import sys; print("e", file=sys.stderr)', timeoutMs: 10_000 }, (r) => assert.equal(r.stdout, "e\n")],
		[
			"reports a traceback with only the learner's frames",
			{ code: "def boom():\n    return 1/0\nboom()", timeoutMs: 10_000 },
			(r) => {
				assert.match(r.error, /File "<code>", line 3, in <module>/);
				assert.match(r.error, /ZeroDivisionError: division by zero$/);
				assert.doesNotMatch(r.error, /_pyodide/);
			},
		],
		["reports a syntax error", { code: "foo(", timeoutMs: 10_000 }, (r) => assert.match(r.error, /SyntaxError/)],
		["passes when the tests pass", { code: "s = [x*x for x in [1, 2, 3]]", tests: "assert s == [1, 4, 9]", timeoutMs: 10_000 }, (r) => {
			assert.equal(r.passed, true);
			assert.equal(r.error, undefined);
		}],
		["fails when a test fails, naming <tests>", { code: "s = []", tests: "assert s == [1]", timeoutMs: 10_000 }, (r) => {
			assert.equal(r.passed, false);
			assert.match(r.error, /File "<tests>"/);
		}],
		["fails when the code itself errors", { code: "1/0", tests: "assert True", timeoutMs: 10_000 }, (r) => assert.equal(r.passed, false)],
		["gives every run a fresh namespace", { code: "print(s)", timeoutMs: 10_000 }, (r) => assert.match(r.error, /NameError/)],
		["makes input() fail instead of hanging", { code: "input()", timeoutMs: 10_000 }, (r) => assert.match(r.error, /OSError/)],
		["runs in an opaque origin", { code: "import js; print(js.origin)", timeoutMs: 10_000 }, (r) => assert.equal(r.stdout, "null\n")],
		["cannot reach the DOM", { code: "from js import document", timeoutMs: 10_000 }, (r) => assert.match(r.error, /ImportError/)],
		["times out an infinite loop and keeps earlier output", { code: "print('before')\nwhile True: pass", timeoutMs: 2_000 }, (r) => {
			assert.equal(r.timedOut, true);
			assert.equal(r.stdout, "before\n");
		}],
		["recovers with a fresh worker after a timeout", { code: 'print("alive")', timeoutMs: 120_000 }, (r) => assert.equal(r.stdout, "alive\n")],
		["caps an output flood", { code: "while True: print('x' * 100)", timeoutMs: 3_000 }, (r) => {
			assert.equal(r.timedOut, true);
			assert.ok(r.stdout.length < 51_000, `stdout was ${r.stdout.length} chars`);
			assert.match(r.stdout, /\[output truncated\]\n$/);
		}],
		["recovers after the flood", { code: 'print("ok")', timeoutMs: 120_000 }, (r) => assert.equal(r.stdout, "ok\n")],
	];

	for (const [name, request, check] of cases) {
		const started = Date.now();
		const result = await run(request);
		assert.equal(result.rejected, undefined, `${name}: runtime rejected: ${result.rejected}`);
		try {
			check(result);
		} catch (error) {
			console.error(`FAIL ${name}\n${JSON.stringify(result, null, 2)}`);
			throw error;
		}
		console.log(`ok   ${name} (${Date.now() - started} ms)`);
	}
	console.log(`\nAll ${cases.length} python runtime checks passed against ${INDEX}`);
} finally {
	await browser.close();
}
