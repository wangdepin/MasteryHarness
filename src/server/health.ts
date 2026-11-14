import packageMetadata from "../../package.json" with { type: "json" };
import { gateMode } from "./access-token.ts";

/** GET /api/health's body: liveness, version, whether a token is required. Nothing else. */
export function healthBody(env: Record<string, string | undefined> = process.env): { ok: true; version: string; tokenMode: boolean } {
	return { ok: true, version: packageMetadata.version, tokenMode: gateMode(env) !== "off" };
}
