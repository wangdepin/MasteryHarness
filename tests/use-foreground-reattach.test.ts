import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STREAM_DROPPED } from "../components/session-core.ts";
import { shouldReattach, type ReattachView } from "../components/use-foreground-reattach.ts";

const view = (over: Partial<ReattachView> = {}): ReattachView => ({ status: "ready", evaluating: false, turnInFlight: false, error: null, ...over });

describe("shouldReattach (a chat page back in the foreground)", () => {
	it("an idle page has nothing to attach to", () => {
		assert.equal(shouldReattach(view()), false);
	});

	it("a stream being read, or waited for, may be dead", () => {
		assert.equal(shouldReattach(view({ status: "streaming" })), true);
		assert.equal(shouldReattach(view({ status: "submitted" })), true);
		assert.equal(shouldReattach(view({ turnInFlight: true })), true);
	});

	it("a graded answer still waiting on its POST is left alone", () => {
		assert.equal(shouldReattach(view({ status: "submitted", evaluating: true })), false);
	});

	it("the dropped-connection banner is retried; any other error stays", () => {
		assert.equal(shouldReattach(view({ status: "error", error: { message: STREAM_DROPPED } })), true);
		assert.equal(shouldReattach(view({ status: "error", error: { message: "No model is configured." } })), false);
		assert.equal(shouldReattach(view({ status: "error", error: null })), false);
		assert.equal(shouldReattach(view({ status: "ready", error: { message: STREAM_DROPPED } })), false);
	});
});
