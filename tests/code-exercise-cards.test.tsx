/**
 * Render smoke tests — the code exercise's dock seat (collapsed bar /
 * malformed fallback) and its transcript record, to static HTML
 * (react-dom/server, same shim as render-cards.test.tsx).
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeExerciseAnsweredCard } from "../components/code-exercise-answered-card.tsx";
import { CodeExerciseDockHost } from "../components/code-exercise-dock-host.tsx";
import { buildCodeAnswer, dismissedCodeAnswer } from "../src/core/code-exercise.ts";

const input = {
	nodeId: "n",
	language: "python",
	question: "Square every number in `nums`.",
	starterCode: "nums = [1, 2]\n",
	explanation: "A comprehension builds the list.",
	tests: "assert squares == [1, 4]",
};

const host = (props: Partial<React.ComponentProps<typeof CodeExerciseDockHost>> = {}): string =>
	renderToStaticMarkup(<CodeExerciseDockHost input={input} expanded onExpand={() => {}} onSubmit={() => {}} {...props} />);

describe("CodeExerciseDockHost", () => {
	it("expanded: the exercise, no bar", () => {
		const html = host();
		assert.match(html, /data-testid="code-exercise-dock"/);
		assert.doesNotMatch(html, /data-testid="question-dock-bar"/);
	});

	it("collapsed: the slim Code bar, with the exercise kept mounted but hidden", () => {
		const html = host({ expanded: false });
		assert.match(html, /data-testid="question-dock-bar"/);
		assert.match(html, />Code</);
		assert.match(html, /class="invisible h-0 overflow-hidden"/);
		assert.match(html, /data-testid="code-exercise-dock"/);
	});

	it("malformed input renders the quiet fallback, never a crash", () => {
		for (const bad of [null, {}, { ...input, language: "ruby" }, { ...input, tests: "  " }, "text"]) {
			assert.match(host({ input: bad }), /data-testid="malformed-question"/);
		}
	});
});

describe("CodeExerciseAnsweredCard", () => {
	const ran = { stdout: "", timedOut: false, durationMs: 2 };
	const card = (lastRun: Parameters<typeof buildCodeAnswer>[1]["lastRun"], graded = true) =>
		renderToStaticMarkup(
			<CodeExerciseAnsweredCard
				answer={buildCodeAnswer({ ...input, language: "python", tests: graded ? input.tests : undefined }, { code: "squares = [1, 4]", runs: 3, lastRun })}
			/>,
		);

	it("shows the question, the submitted code and the passed verdict", () => {
		const html = card({ ...ran, passed: true, stdout: "done\n" });
		assert.match(html, /Square every number in/);
		assert.match(html, /squares = \[1, 4\]/);
		assert.match(html, /Checks passed/);
		assert.match(html, /done/);
	});

	it("shows a failed check and its traceback", () => {
		const html = card({ ...ran, passed: false, error: "AssertionError" });
		assert.match(html, /Checks failed/);
		assert.match(html, /AssertionError/);
	});

	it("a run-only exercise shows output but no verdict", () => {
		const html = card({ ...ran, stdout: "hello\n" }, false);
		assert.match(html, /hello/);
		assert.doesNotMatch(html, /Checks (passed|failed)/);
	});

	it("tucks the explanation behind Why", () => {
		const html = card({ ...ran, passed: true });
		assert.match(html, /data-testid="tucked-explanation"/);
		assert.doesNotMatch(html, /comprehension builds/);
	});

	it("a dismissed exercise renders as skipped", () => {
		const html = renderToStaticMarkup(<CodeExerciseAnsweredCard answer={dismissedCodeAnswer({ language: "python", question: "Q?" })} />);
		assert.match(html, /Q\?<\/span> — skipped/);
		assert.doesNotMatch(html, /code-answered-card/);
	});
});
