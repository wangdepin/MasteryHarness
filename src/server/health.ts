import packageMetadata from "../../package.json" with { type: "json" };
import { tokenModeOn } from "./access-gate.ts";

/** GET /api/health's body (Android plan M6): liveness, version, whether a token is required. Nothing else. */
export function healthBody(env: Record<string, string | undefined> = process.env): { ok: true; version: string; tokenMode: boolean } {
	return { ok: true, version: packageMetadata.version, tokenMode: tokenModeOn(env) };
}
