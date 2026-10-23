/**
 * The Review surface (docs/review-plan.md §4.4): the pure page body, the
 * selection rules and the sidebar door. Same classic-JSX shim as the other
 * render suites.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewDoor } from "../components/review-nav-row.tsx";
import {
	ReviewBody,
	defaultSelection,
	effectiveSelection,
	formatDue,
	reviewSessionText,
	toggleSelection,
} from "../components/review-view.tsx";
import { REVIEW_SESSION_MAX, type ReviewItem, type ReviewPayload } from "../src/core/index.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 23, 12);

function item(id: string, dueAt: number, name = `Name ${id}`): ReviewItem {
	return { id, name, statement: `statement ${id}`, dueAt, stability: 3, reps: 1, lapses: 0, verifying: false };
}

function payload(over: Partial<ReviewPayload> = {}): ReviewPayload {
	return { now: NOW, due: [], upcoming: [], sessionSize: 8, ...over };
}

function body(p: ReviewPayload | null, selected: string[] = [], busy = false): string {
	return renderToStaticMarkup(
		<ReviewBody payload={p} selected={new Set(selected)} busy={busy} onToggle={() => {}} onStart={() => {}} />,
	);
}

describe("formatDue", () => {
	const cases: Array<[number, string]> = [
		[NOW - 3 * DAY - 1000, "overdue 3d"],
		[NOW - 1000, "due today"],
		[NOW, "due today"],
		[NOW + 1000, "in 1d"],
		[NOW + 5 * DAY, "in 5d"],
		[NOW + 5 * DAY + 1000, "in 6d"],
	];
	for (const [dueAt, expected] of cases) {
		it(`${(dueAt - NOW) / DAY} days from now reads "${expected}"`, () => {
			assert.equal(formatDue(dueAt, NOW), expected);
		});
	}
});

describe("reviewSessionText (owner, 2026-10-23)", () => {
	it("is 'Review: ' plus the node names, comma-separated", () => {
		assert.equal(reviewSessionText([{ name: "Alpha" }, { name: "Beta" }]), "Review: Alpha, Beta");
	});
});

describe("selection rules", () => {
	const due = Array.from({ length: 10 }, (_, i) => item(`n${i}`, NOW - (10 - i) * DAY));

	it("the default is the most overdue, up to the session size", () => {
		const sel = defaultSelection(payload({ due }));
		assert.equal(sel.size, 8);
		assert.ok(sel.has("n0") && sel.has("n7") && !sel.has("n8"));
	});

	it("toggle adds and removes, without mutating the input", () => {
		const base = new Set(["n0"]);
		const added = toggleSelection(base, "n1");
		assert.deepEqual([...added].sort(), ["n0", "n1"]);
		assert.deepEqual([...base], ["n0"]);
		assert.deepEqual([...toggleSelection(added, "n0")], ["n1"]);
	});

	it("adding past the session maximum is refused", () => {
		const full = new Set(Array.from({ length: REVIEW_SESSION_MAX }, (_, i) => `x${i}`));
		assert.equal(toggleSelection(full, "extra").size, REVIEW_SESSION_MAX);
		assert.equal(toggleSelection(full, "x0").size, REVIEW_SESSION_MAX - 1);
	});

	it("untouched picks fall back to the default; touched picks keep only what is still due", () => {
		const p = payload({ due });
		assert.equal(effectiveSelection(p, null).size, 8);
		assert.deepEqual([...effectiveSelection(p, new Set(["n9", "gone"]))], ["n9"]);
		assert.equal(effectiveSelection(null, null).size, 0);
	});
});

describe("ReviewBody", () => {
	it("shows Loading… until the payload arrives", () => {
		assert.ok(body(null).includes("Loading…"));
	});

	it("an empty review says nothing is due and offers no Start button", () => {
		const html = body(payload());
		assert.ok(html.includes('data-testid="review-empty"'));
		assert.ok(!html.includes("review-start"));
	});

	it("lists due rows with checkboxes, the selected ones checked, and a Start button with the count", () => {
		const html = body(payload({ due: [item("a", NOW - 2 * DAY), item("b", NOW - DAY)] }), ["a"]);
		assert.ok(html.includes("Due now · 2"));
		assert.ok(html.includes("overdue 2d") && html.includes("overdue 1d"));
		assert.ok(html.includes("Start review (1)"));
		assert.match(html, /aria-label="Review Name a"[^>]*checked|checked[^>]*aria-label="Review Name a"/);
		assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
	});

	it("Start is disabled with nothing selected, and while busy", () => {
		const p = payload({ due: [item("a", NOW - DAY)] });
		assert.match(body(p, []), /<button[^>]*disabled[^>]*data-testid="review-start"|data-testid="review-start"[^>]*disabled/);
		assert.match(body(p, ["a"], true), /disabled/);
		assert.doesNotMatch(body(p, ["a"], false), /disabled=""/);
	});

	it("a verifying row is marked 're-check'; other rows are not", () => {
		const verifying = { ...item("v", NOW - DAY), verifying: true };
		const html = body(payload({ due: [verifying, item("p", NOW - DAY)] }));
		assert.ok(html.includes('data-testid="review-verifying-v"'));
		assert.ok(!html.includes('data-testid="review-verifying-p"'));
		assert.ok(html.includes("re-check"));
	});

	it("upcoming rows list when they exist, with no checkboxes", () => {
		const html = body(payload({ upcoming: [item("u", NOW + 4 * DAY)] }));
		assert.ok(html.includes("Upcoming · 1"));
		assert.ok(html.includes("in 4d"));
		assert.ok(!html.includes('type="checkbox"'));
	});
});

describe("ReviewDoor (the sidebar row)", () => {
	const door = (dueCount: number) => renderToStaticMarkup(<ReviewDoor dueCount={dueCount} onOpen={() => {}} />);

	it("shows the due count once anything is due", () => {
		const html = door(5);
		assert.ok(html.includes('data-testid="nav-review-count"'));
		assert.ok(html.includes(">5<"));
		assert.ok(html.includes("open review, 5 due"));
	});

	it("shows no count when nothing is due", () => {
		const html = door(0);
		assert.ok(!html.includes("nav-review-count"));
		assert.ok(html.includes("open review, nothing due"));
	});
});
