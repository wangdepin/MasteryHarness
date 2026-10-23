/**
 * Render smoke test — the code-exercise dock's first paint, to static HTML
 * (react-dom/server, same shim as render-cards.test.tsx). The interactions
 * (run → output → submit, the stale-run law) are the reducer's tests
 * (code-exercise-session.test.ts) and the real-browser check.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeExerciseDock } from "../components/code-exercise-dock.tsx";
import type { CodeRuntime } from "../src/core/code-exercise.ts";

const input = {
	language: "python" as const,
	question: "Square every number in `nums`.",
	starterCode: "nums = [10, 20, 30]\nsquares = []\n",
	explanation: "A comprehension builds the list in one expression.",
	tests: "assert squares == [100, 400, 900]",
};

const runtime: CodeRuntime = {
	language: "python",
	run: () => Promise.reject(new Error("not used in a static render")),
};

const render = (props: Partial<React.ComponentProps<typeof CodeExerciseDock>> = {}): string =>
	renderToStaticMarkup(<CodeExerciseDock input={input} runtime={runtime} onSubmit={() => {}} {...props} />);

describe("CodeExerciseDock first paint", () => {
	it("shows the label, the question and the starter code", () => {
		const html = render();
		assert.match(html, /Code · Python/);
		assert.match(html, /Square every number in/);
		assert.match(html, /nums = \[10, 20, 30\]\nsquares = \[\]/);
	});

	it("offers Run but keeps Submit closed until the code has been run", () => {
		const html = render();
		assert.match(html, /data-testid="code-run"(?![^>]*disabled)/);
		assert.match(html, /<button[^>]*data-testid="code-submit"[^>]*disabled/);
		assert.match(html, /run your code to submit/);
		assert.match(html, /Run your code to see its output here/);
	});

	it("offers a Your thinking field beside Submit", () => {
		const html = render();
		assert.match(html, /data-testid="thinking-field"/);
		assert.match(html, /YOUR THINKING/);
		assert.match(html, /<textarea[^>]*data-testid="code-thinking"/);
	});

	it("hints the editor's run chord", () => {
		assert.match(render(), /data-testid="code-run-hint"[^>]*>\s*⌘↵ runs/);
	});

	it("never renders the tests or the explanation", () => {
		const html = render();
		assert.doesNotMatch(html, /assert squares/);
		assert.doesNotMatch(html, /comprehension builds/);
	});

	it("disables Run for a blank starter", () => {
		const html = render({ input: { ...input, starterCode: "" } });
		assert.match(html, /<button[^>]*data-testid="code-run"[^>]*disabled/);
	});

	it("says why Submit is closed while compaction runs", () => {
		assert.match(render({ compactionRunning: true }), /compacting session…/);
	});
});
