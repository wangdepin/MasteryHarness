/**
 * POST /api/tts — read-aloud for the sentence reader (owner, 2026-10-21).
 * { text, voice?, model?, rate? } → audio bytes. The ElevenLabs key is read
 * server-side (keyValue); the renderer never sees it.
 */
import { parseTtsBody } from "@/src/core";
import { synthesizeSpeech, TtsError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ message: "Invalid JSON body" }, { status: 400 });
	}
	const parsed = parseTtsBody(body);
	if (!parsed.ok) return Response.json({ message: parsed.error }, { status: 400 });

	try {
		const audio = await synthesizeSpeech(parsed.request);
		return new Response(audio.bytes as BodyInit, {
			headers: { "Content-Type": audio.mime, "Cache-Control": "no-store" },
		});
	} catch (err) {
		if (err instanceof TtsError) return Response.json({ message: err.message }, { status: err.status });
		return Response.json({ message: "TTS failed" }, { status: 502 });
	}
}
