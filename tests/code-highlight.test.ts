/** Python highlighting for the exercise editor: text always comes from the code, colors from shiki. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { carryRuns, highlightPython, plainRuns, runsFromTokens, type Run } from "../components/code-highlight.ts";

const text = (runs: readonly Run[]): string => runs.map((r) => r.text).join("");
const tok = (content: string, color?: string) => ({
	content,
	...(color ? { htmlStyle: { color, "--shiki-dark": `${color}-dark` } } : {}),
});

/** The real highlighter, awaited: highlightPython answers now when cached, else by callback. */
function highlighted(code: string): Promise<Run[]> {
	return new Promise((resolve) => {
		const now = highlightPython(code, resolve);
		if (now) resolve(now);
	});
}

describe("runsFromTokens", () => {
	it("keeps each token's light and dark color and rebuilds the code exactly", () => {
		const runs = runsFromTokens("def f", [[tok("def", "#d00"), tok(" "), tok("f", "#00d")]]);
		assert.deepEqual(runs, [
			{ text: "def", light: "#d00", dark: "#d00-dark" },
			{ text: " " },
			{ text: "f", light: "#00d", dark: "#00d-dark" },
		]);
	});

	it("joins lines with newlines, including an empty last line", () => {
		const runs = runsFromTokens("a\nb\n", [[tok("a")], [tok("b")], []]);
		assert.equal(text(runs!), "a\nb\n");
	});

	it("refuses tokens whose text is not this code", () => {
		assert.equal(runsFromTokens("x - y", [[tok("x + y")]]), null);
	});
});

describe("carryRuns", () => {
	const prev: Run[] = [{ text: "def", light: "#d00", dark: "#d00-dark" }, { text: " f(x):" }];

	it("returns the same text with the same colors when nothing changed", () => {
		assert.deepEqual(carryRuns(prev, "def f(x):"), prev);
	});

	it("keeps the colors around a typed character and gives it its left neighbour's color", () => {
		const next = carryRuns(prev, "defx f(x):");
		assert.equal(text(next), "defx f(x):");
		assert.deepEqual(next[0], { text: "defx", light: "#d00", dark: "#d00-dark" });
		assert.deepEqual(next[1], { text: " f(x):" });
	});

	it("keeps the colors after a deleted character", () => {
		const next = carryRuns(prev, "de f(x):");
		assert.equal(text(next), "de f(x):");
		assert.deepEqual(next[0], { text: "de", light: "#d00", dark: "#d00-dark" });
	});

	it("carries colors across an overwrite of the same length", () => {
		const next = carryRuns(prev, "def f(y):");
		assert.equal(text(next), "def f(y):");
		assert.deepEqual(next[0], { text: "def", light: "#d00", dark: "#d00-dark" });
	});

	it("starts plain when there is nothing to carry from", () => {
		assert.deepEqual(carryRuns([], "pass"), [{ text: "pass" }]);
	});

	it("handles code cleared and refilled", () => {
		assert.equal(text(carryRuns(prev, "")), "");
		assert.equal(text(carryRuns([{ text: "" }], "pass")), "pass");
	});
});

describe("plainRuns", () => {
	it("is the code with no color", () => {
		assert.deepEqual(plainRuns("x = 1"), [{ text: "x = 1" }]);
		assert.deepEqual(plainRuns(""), []);
	});
});

describe("highlightPython (the chat's shiki)", () => {
	it("colors Python and reproduces the code exactly", async () => {
		const code = 'def f(x):\n    # note\n    return "hi" + str(x)\n';
		const runs = await highlighted(code);
		assert.equal(text(runs), code);
		const keyword = runs.find((r) => r.text === "def");
		assert.ok(keyword?.light && keyword.dark, "a keyword carries a light and a dark color");
		assert.notEqual(keyword.light, runs.find((r) => r.text === " ")?.light);
	});

	it("never serves one code's text for another of the same length and ends", async () => {
		// shiki's plugin keys its cache on length + first/last 100 chars only.
		const pad = "x".repeat(120);
		const before = `${pad}+${pad}`;
		const after = `${pad}-${pad}`;
		assert.equal(text(await highlighted(before)), before);
		assert.equal(text(await highlighted(after)), after);
	});

	it("handles the empty program", async () => {
		assert.equal(text(await highlighted("")), "");
	});
});
