/**
 * ElevenLabs text-to-speech call (owner, 2026-10-21). The key never leaves
 * the server: the reader POSTs text to /api/tts, this module calls
 * ElevenLabs with ELEVENLABS_API_KEY and hands back MP3 bytes.
 */
import { elevenLabsBody, type TtsAudio, type TtsRequest } from "../core/tts.ts";
import { keyValue } from "./keys.ts";

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

export class TtsError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export async function synthesizeSpeech(req: TtsRequest, fetchImpl: typeof fetch = fetch): Promise<TtsAudio> {
	const key = keyValue("ELEVENLABS_API_KEY");
	if (!key) throw new TtsError("No ELEVENLABS_API_KEY — add an ElevenLabs key in Settings → Keys.", 503);

	let res: Response;
	try {
		res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(req.voice)}?output_format=mp3_44100_128`, {
			method: "POST",
			headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
			body: JSON.stringify(elevenLabsBody(req)),
			signal: AbortSignal.timeout(30_000),
		});
	} catch {
		throw new TtsError("ElevenLabs is unreachable", 502);
	}
	if (!res.ok) {
		const status = res.status === 429 ? 429 : 502;
		let detail = "";
		try {
			const json = (await res.json()) as { detail?: { message?: string } | string };
			detail = typeof json.detail === "string" ? json.detail : (json.detail?.message ?? "");
		} catch {
			/* not JSON */
		}
		throw new TtsError(`ElevenLabs TTS failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`, status);
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (bytes.length === 0) throw new TtsError("ElevenLabs returned no audio", 502);
	return { bytes, mime: "audio/mpeg" };
}
