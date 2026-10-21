import type { Model } from "@earendil-works/pi-ai";
import type { AntigravityRouting, ThinkingWire } from "./types.ts";
import { ANTIGRAVITY_API } from "./types.ts";
import { ThinkingEffort } from "./enums.ts";

export const PROVIDER_ID = "antigravity";
export const PROVIDER_NAME = "Google Antigravity";

/** The base URL a model advertises; real requests walk endpointCandidates(). */
const BASE_URL = "https://daily-cloudcode-pa.googleapis.com";

/**
 * Public model ids → backend request model ids by thinking level. The set is
 * the owner-approved shortlist (2026-10-21), every runtime id taken from the
 * live fetchAvailableModels of a real account the same day. Only Gemini 3.8
 * Flash was exercised end to end; the rest are catalog-listed.
 */
export const ANTIGRAVITY_ROUTING: Record<string, AntigravityRouting> = {
	"gemini-3.8-flash": {
		routing: {
			low: "gemini-3.8-flash-low",
			medium: "gemini-3.8-flash-medium",
			high: "gemini-3.8-flash-high",
		},
		defaultRequestId: "gemini-3.8-flash-low",
	},
	"gemini-4-argon": {
		routing: {
			low: "gemini-4-argon-low",
			medium: "gemini-4-argon-medium",
			high: "gemini-4-argon-high",
		},
		defaultRequestId: "gemini-4-argon-low",
	},
	"gemini-2.5-pro": {
		routing: { low: "gemini-2.5-pro", medium: "gemini-2.5-pro", high: "gemini-2.5-pro" },
		defaultRequestId: "gemini-2.5-pro",
	},
	"claude-sonnet-5-5": {
		routing: {
			low: "claude-sonnet-5-5-low",
			medium: "claude-sonnet-5-5-medium",
			high: "claude-sonnet-5-5-high",
		},
		defaultRequestId: "claude-sonnet-5-5-low",
	},
	"claude-opus-5-5": {
		routing: {
			low: "claude-opus-5-5-low",
			medium: "claude-opus-5-5-medium",
			high: "claude-opus-5-5-high",
		},
		defaultRequestId: "claude-opus-5-5-low",
	},
	"gpt-oss-120b": {
		routing: { medium: "gpt-oss-120b-medium" },
		defaultRequestId: "gpt-oss-120b-medium",
	},
};

/** Maximum output tokens the backend accepts per model family (more is a 400). */
export function getMaxOutputTokens(modelId: string, runtimeModel?: string): number {
	const id = runtimeModel ?? modelId;
	if (id.startsWith("claude-")) return 64000;
	if (id.startsWith("gpt-oss-")) return 32768;
	if (id.startsWith("gemini-")) return 65536;
	return 8192;
}

// A null entry hides that level from the picker: show exactly the levels the
// backend advertises per model.
const levels = {
	lowMediumHigh: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null },
	mediumOnly: { off: null, minimal: null, low: null, medium: "medium", high: null, xhigh: null, max: null },
} as const;

// Subscription access: no per-token bill, so the app's cost estimate stays zero.
const noCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function model(
	id: string,
	name: string,
	thinkingLevelMap: Model<typeof ANTIGRAVITY_API>["thinkingLevelMap"],
	input: Model<typeof ANTIGRAVITY_API>["input"],
	contextWindow: number,
	maxTokens: number,
): Model<typeof ANTIGRAVITY_API> {
	return {
		id,
		name,
		api: ANTIGRAVITY_API,
		provider: PROVIDER_ID,
		baseUrl: BASE_URL,
		reasoning: true,
		thinkingLevelMap,
		input,
		cost: noCost,
		contextWindow,
		maxTokens,
	};
}

/** The catalog pi-ai's provider serves. */
export const ANTIGRAVITY_MODELS: readonly Model<typeof ANTIGRAVITY_API>[] = [
	model("gemini-3.8-flash", "Gemini 3.8 Flash (Antigravity)", levels.lowMediumHigh, ["text", "image"], 1048576, 65536),
	model("gemini-4-argon", "Gemini 4 Argon (Antigravity)", levels.lowMediumHigh, ["text", "image"], 1048576, 65536),
	model("gemini-2.5-pro", "Gemini 2.5 Pro (Antigravity)", levels.lowMediumHigh, ["text", "image"], 1048576, 65536),
	model("claude-sonnet-5-5", "Claude Sonnet 5.5 (Antigravity)", levels.lowMediumHigh, ["text", "image"], 200000, 64000),
	model("claude-opus-5-5", "Claude Opus 5.5 (Antigravity)", levels.lowMediumHigh, ["text", "image"], 200000, 64000),
	model("gpt-oss-120b", "GPT-OSS 120B (Antigravity)", levels.mediumOnly, ["text"], 131072, 32768),
];

export function getCurrentAntigravityRouting(): Record<string, AntigravityRouting> {
	return ANTIGRAVITY_ROUTING;
}

/** Resolve public model id + thinking effort to the backend's runtime model id. */
export function getAntigravityRequestModelId(modelId: string, effort: string | undefined): string {
	const r = ANTIGRAVITY_ROUTING[modelId];
	if (!r) return modelId;
	const order: ThinkingEffort[] =
		effort === ThinkingEffort.High || effort === ThinkingEffort.Xhigh
			? [ThinkingEffort.High, ThinkingEffort.Medium, ThinkingEffort.Low]
			: effort === ThinkingEffort.Medium
				? [ThinkingEffort.Medium, ThinkingEffort.Low, ThinkingEffort.High]
				: [ThinkingEffort.Low, ThinkingEffort.Medium, ThinkingEffort.High];
	for (const level of order) {
		const id = r.routing?.[level];
		if (id) return id;
	}
	return r.defaultRequestId ?? modelId;
}

export type { ThinkingWire };

/**
 * `model_enum` labels learned from fetchAvailableModels. The backend tags each
 * request with its model's enum; unknown ids are sent without the label (the
 * Gemini path was verified to work that way).
 */
const modelEnumCache = new Map<string, string>();

/** Register a discovered model enum. */
export function registerModelEnum(wireModelId: string, modelEnum: string): void {
	if (wireModelId && modelEnum) modelEnumCache.set(wireModelId, modelEnum);
}

/** Register the enums from a fetchAvailableModels `models` dictionary. */
export function registerDiscoveredModelEnums(models: Record<string, { model?: unknown }> | undefined): void {
	if (!models) return;
	for (const [wireId, info] of Object.entries(models)) {
		if (typeof info?.model === "string" && info.model) modelEnumCache.set(wireId, info.model);
	}
}

/** The model_enum label for a wire model id, when discovery has seen it. */
export function getModelEnum(wireModelId: string): string | undefined {
	return modelEnumCache.get(wireModelId);
}

export function getThinkingConfig(modelId: string, effort: string | undefined): ThinkingWire | undefined {
	const off = !effort || effort === "off";
	if (modelId.startsWith("claude-")) {
		return off ? { includeThoughts: false, thinkingBudget: 0 } : { includeThoughts: true, thinkingBudget: 1024 };
	}
	if (modelId.startsWith("gpt-oss-")) {
		return off ? { includeThoughts: false, thinkingBudget: 0 } : { includeThoughts: true, thinkingBudget: 8192 };
	}
	// Gemini 4 Argon rejects thinkingBudget 0 and any budget under 1000.
	if (modelId.includes("argon") || modelId.startsWith("gemini-4")) {
		if (off) return undefined;
		const thinkingBudget = effort === "high" || effort === "xhigh" ? -1 : effort === "medium" ? 4_000 : 1_000;
		return { includeThoughts: true, thinkingBudget };
	}
	if (modelId.startsWith("gemini-")) {
		if (off) return { includeThoughts: false, thinkingBudget: 0 };
		const thinkingBudget = effort === "high" || effort === "xhigh" ? -1 : effort === "medium" ? 4_000 : 1_000;
		return { includeThoughts: true, thinkingBudget };
	}
	return undefined;
}
