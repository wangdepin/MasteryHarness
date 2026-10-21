/**
 * Read-aloud for the sentence reader (owner, 2026-10-21): ElevenLabs TTS through
 * POST /api/tts, decoded and played with Web Audio; any failure (no key,
 * quota, network) drops to the browser's built-in speechSynthesis instead.
 */

export interface SpeakerSettings {
	voice: string;
	rate: number;
}

export type SpeakerEngine = "cloud" | "browser";

export class ReaderSpeaker {
	private ctx: AudioContext | null = null;
	private source: AudioBufferSourceNode | null = null;
	private cache = new Map<string, Promise<AudioBuffer>>();
	private token = 0;
	/** Set once ElevenLabs failed this session; the browser voice is used from then on. */
	cloudFailure: string | null = null;

	engine(): SpeakerEngine {
		return this.cloudFailure === null ? "cloud" : "browser";
	}

	private audioContext(): AudioContext {
		this.ctx ??= new AudioContext();
		return this.ctx;
	}

	private load(text: string, s: SpeakerSettings): Promise<AudioBuffer> {
		const key = `${s.voice}|${s.rate}|${text}`;
		let hit = this.cache.get(key);
		if (!hit) {
			hit = this.fetchBuffer(text, s);
			this.cache.set(key, hit);
			hit.catch(() => this.cache.delete(key));
		}
		return hit;
	}

	private async fetchBuffer(text: string, s: SpeakerSettings): Promise<AudioBuffer> {
		const res = await fetch("/api/tts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text, voice: s.voice, rate: s.rate }),
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			throw new Error(body.message ?? `TTS failed (${res.status})`);
		}
		return this.audioContext().decodeAudioData(await res.arrayBuffer());
	}

	/** Warm the cache for the sentence after the current one. */
	prefetch(text: string, s: SpeakerSettings): void {
		if (this.cloudFailure !== null || text === "") return;
		void this.load(text, s).catch(() => {});
	}

	stop(): void {
		this.token++;
		try {
			this.source?.stop();
		} catch {
			// Already ended.
		}
		this.source = null;
		if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
	}

	/** Speak `text`, replacing anything playing. Resolves when it ends (or is replaced). */
	async speak(text: string, s: SpeakerSettings): Promise<void> {
		this.stop();
		if (text === "") return;
		const mine = this.token;
		if (this.cloudFailure === null) {
			try {
				const buffer = await this.load(text, s);
				if (mine !== this.token) return;
				const ctx = this.audioContext();
				if (ctx.state === "suspended") await ctx.resume();
				await new Promise<void>((resolve) => {
					const node = ctx.createBufferSource();
					node.buffer = buffer;
					node.connect(ctx.destination);
					node.onended = () => resolve();
					this.source = node;
					node.start();
				});
				return;
			} catch (err) {
				if (mine !== this.token) return;
				this.cloudFailure = err instanceof Error ? err.message : "TTS failed";
			}
		}
		await this.speakWithBrowser(text, s, mine);
	}

	private speakWithBrowser(text: string, s: SpeakerSettings, mine: number): Promise<void> {
		return new Promise((resolve) => {
			if (typeof speechSynthesis === "undefined" || mine !== this.token) return resolve();
			const u = new SpeechSynthesisUtterance(text);
			u.rate = s.rate;
			u.onend = () => resolve();
			u.onerror = () => resolve();
			speechSynthesis.speak(u);
		});
	}
}
