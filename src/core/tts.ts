/**
 * Read-aloud (TTS) pure layer (owner, 2026-10-21): the request contract for
 * POST /api/tts and the ElevenLabs request it maps to. No I/O here — the
 * server module (src/server/tts.ts) does the network call.
 */

/** ElevenLabs premade voices offered in the reader: [voice id, label]. */
export const TTS_VOICES: ReadonlyArray<readonly [string, string]> = [
	["JBFqnCBsd6RMkjVDRZzb", "George · warm storyteller"],
	["nPczCjzI2devNBz1zQrb", "Brian · deep narrator"],
	["onwK4e9ZLuTAKqWW03F9", "Daniel · steady broadcaster"],
	["cjVigY5qzO86Huf0OWal", "Eric · smooth"],
	["Xb7hH8MSUJpSbSDYk0k2", "Alice · clear educator"],
	["XrExE9yKIg1WjnnlVkGX", "Matilda · friendly"],
	["pFZP5JQG7iQjIQuC4Bku", "Lily · velvety"],
	["cgSgspJ2msm6clMCkdW9", "Jessica · expressive"],
];

export const DEFAULT_TTS_VOICE = TTS_VOICES[0]![0];

/** `flash` is cheap and fast; `multilingual` sounds richer. Both speak Chinese. */
export const TTS_MODELS = {
	flash: "eleven_flash_v2_5",
	multilingual: "eleven_multilingual_v2",
} as const;

export type TtsModelKey = keyof typeof TTS_MODELS;

/** One request's text ceiling (characters) — a sentence or a few. */
export const TTS_MAX_CHARS = 3000;

/** ElevenLabs' `voice_settings.speed` range is 0.7–1.2. */
export const TTS_RATE_MIN = 0.7;
export const TTS_RATE_MAX = 1.2;

export interface TtsRequest {
	text: string;
	voice: string;
	model: TtsModelKey;
	/** Speaking speed, 0.7–1.2. */
	rate: number;
}

export interface TtsAudio {
	bytes: Uint8Array;
	mime: string;
}

export type TtsBodyResult = { ok: true; request: TtsRequest } | { ok: false; error: string };

/** Validate the POST /api/tts body; every field but `text` is optional. */
export function parseTtsBody(body: unknown): TtsBodyResult {
	if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid JSON body" };
	const raw = body as Record<string, unknown>;
	if (typeof raw.text !== "string" || raw.text.trim() === "") return { ok: false, error: "text must be a non-empty string" };
	const text = raw.text.trim();
	if (text.length > TTS_MAX_CHARS) return { ok: false, error: `text is longer than ${TTS_MAX_CHARS} characters` };

	const voice = raw.voice === undefined ? DEFAULT_TTS_VOICE : raw.voice;
	if (typeof voice !== "string" || !TTS_VOICES.some(([id]) => id === voice)) {
		return { ok: false, error: "voice must be one of the offered voice ids" };
	}
	const model = raw.model === undefined ? "flash" : raw.model;
	if (model !== "flash" && model !== "multilingual") return { ok: false, error: 'model must be "flash" or "multilingual"' };
	const rate = raw.rate === undefined ? 1 : raw.rate;
	if (typeof rate !== "number" || !Number.isFinite(rate) || rate < TTS_RATE_MIN || rate > TTS_RATE_MAX) {
		return { ok: false, error: `rate must be a number between ${TTS_RATE_MIN} and ${TTS_RATE_MAX}` };
	}
	return { ok: true, request: { text, voice, model, rate } };
}

/** The ElevenLabs text-to-speech JSON body for one request. */
export function elevenLabsBody(req: TtsRequest): Record<string, unknown> {
	return { text: req.text, model_id: TTS_MODELS[req.model], voice_settings: { speed: req.rate } };
}
