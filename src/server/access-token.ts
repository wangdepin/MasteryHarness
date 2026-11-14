/**
 * Whether the access gate is in force, and with which token.
 *
 * The gate is opt-in: with LH_ACCESS_TOKEN unset the server behaves exactly
 * as it did before the gate existed. A token that is set but malformed is a
 * mistake, not a request for an open server, so it closes everything.
 */

type Env = Record<string, string | undefined>;

export type GateMode = "off" | "on" | "misconfigured";

/** 256 bits as hex: what `openssl rand -hex 32` prints. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

/** The Electron header mode takes precedence; an unset or empty token is off. */
export function gateMode(env: Env = process.env): GateMode {
	if (env.LH_DESKTOP_SERVER === "1") return "off";
	const token = env.LH_ACCESS_TOKEN;
	if (!token) return "off";
	return TOKEN_PATTERN.test(token) ? "on" : "misconfigured";
}

/** The configured token. Meaningful only when `gateMode` is "on". */
export function accessToken(env: Env = process.env): string {
	return env.LH_ACCESS_TOKEN ?? "";
}
