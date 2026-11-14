import { ACCESS_COOKIE, accessCookieValid, cookieValue } from "./access-cookie.ts";
import { crossSiteRequest, isApiPath, type FetchMetadata } from "./access-fetch-metadata.ts";
import { hostAllowed, originMatchesHost } from "./access-host.ts";
import { PAIR_PATH } from "./access-pairing-page.ts";
import { accessToken, gateMode } from "./access-token.ts";

/**
 * The access gate for a server reached from other devices.
 *
 * On only when LH_ACCESS_TOKEN is set (and the Electron header mode is not):
 * unset, nothing here applies and the server is open as it always was. A
 * device pairs once by posting the token to the pairing form; from then on
 * it carries a signed cookie. Pages are gated as well as /api, because
 * Server Components render chat data directly.
 *
 * Pure: `accessDecision` takes plain values, `proxy.ts` turns the result
 * into a response. The gate began as the token gate of
 * TobiasSamsonsen/learnharness.
 */

/** Public readiness probe; Host-checked only. */
export const HEALTH_PATH = "/api/health";

type Env = Record<string, string | undefined>;

export interface AccessRequest {
	method: string;
	pathname: string;
	/** The query string with its leading "?", or "". */
	search: string;
	host: string | null;
	origin: string | null;
	cookieHeader: string | null;
	fetchMetadata: FetchMetadata;
}

export type AccessDecision =
	| { kind: "allow" }
	/** Answer with the pairing form; `next` is where the browser was going. */
	| { kind: "pair"; next: string }
	| { kind: "deny"; surface: "page" | "api"; status: 403 | 503; reason: string };

const ALLOW: AccessDecision = { kind: "allow" };
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isRead(method: string): boolean {
	return method === "GET" || method === "HEAD";
}

function isPairingSubmission(req: AccessRequest): boolean {
	return req.method === "POST" && req.pathname === PAIR_PATH && originMatchesHost(req.origin, req.host);
}

function isPaired(req: AccessRequest, env: Env, nowMs: number): boolean {
	return accessCookieValid(cookieValue(req.cookieHeader, ACCESS_COOKIE), accessToken(env), nowMs);
}

export function accessRequestOf(request: Request): AccessRequest {
	const url = new URL(request.url);
	const header = (name: string) => request.headers.get(name);
	return {
		method: request.method.toUpperCase(),
		pathname: url.pathname,
		search: url.search,
		host: header("host"),
		origin: header("origin"),
		cookieHeader: header("cookie"),
		fetchMetadata: { site: header("sec-fetch-site"), mode: header("sec-fetch-mode"), dest: header("sec-fetch-dest") },
	};
}

/** The first rule that matches decides; the order is the order of the checks below. */
export function accessDecision(req: AccessRequest, env: Env = process.env, nowMs: number = Date.now()): AccessDecision {
	const mode = gateMode(env);
	if (mode === "off") return ALLOW;
	const surface = isApiPath(req.pathname) ? "api" : "page";
	const deny = (reason: string, status: 403 | 503 = 403): AccessDecision => ({ kind: "deny", surface, status, reason });

	if (!hostAllowed(req.host, env)) return deny("host not allowed");
	if (req.pathname === HEALTH_PATH && isRead(req.method)) return ALLOW;
	if (mode === "misconfigured") return deny("LH_ACCESS_TOKEN must be 64 hexadecimal characters", 503);
	if (crossSiteRequest(req.method, req.pathname, req.fetchMetadata)) return deny("cross-site request");
	if (isPairingSubmission(req)) return ALLOW;
	if (!isPaired(req, env, nowMs)) {
		if (surface === "page" && isRead(req.method)) return { kind: "pair", next: req.pathname + req.search };
		return deny("not paired: open the app in a browser and enter the access token");
	}
	if (SAFE_METHODS.has(req.method)) return ALLOW;
	if (!req.origin) return deny("a write needs an Origin header");
	if (!originMatchesHost(req.origin, req.host)) return deny("cross-origin write");
	return ALLOW;
}
