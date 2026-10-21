/**
 * The provider's fetch. pi-antigravity pooled connections with an undici
 * Agent; this app runs on Node 22+, whose built-in fetch already keeps
 * connections alive, so the plain global fetch is used (no undici dependency).
 */
export async function antigravityFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}

/** Kept so stream.ts's call site stays unchanged; connection warm-up is not needed. */
export function prewarmConnection(_url: string): void {}
