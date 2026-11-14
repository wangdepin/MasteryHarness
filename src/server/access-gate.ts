import { timingSafeEqual } from "node:crypto";

/**
 * Browser-mode access gate for a headless server (Android plan M6).
 *
 * On only when LH_ACCESS_TOKEN is set (and the Electron header mode is not):
 * unset, nothing here applies and the server is open as it always was. The
 * token rides an HttpOnly, SameSite=Strict cookie set by visiting any page
 * with ?lh_token=<token> (the pairing URL the start script prints); that
 * visit redirects to the same URL without the token. Pages are gated as
 * well as /api, because Server Components render chat data directly.
 *
 * Also in token mode: the Host must be loopback (or listed in
 * LH_ALLOWED_HOSTS) against DNS rebinding, and a mutation must carry an
 * Origin equal to the Host against cross-site writes.
 *
 * Pure: `accessDecision` takes plain values, `proxy.ts` turns the result
 * into a response.
 */

export const ACCESS_COOKIE = "lh_token";
export const PAIR_PARAM = "lh_token";
/** Public readiness probe; Host-checked only. */
export const HEALTH_PATH = "/api/health";
/** A shorter token fails closed: every request is denied. */
export const MIN_TOKEN_LENGTH = 32;
/** How long a paired browser stays paired. */
export const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

type Env = Record<string, string | undefined>;

export interface AccessRequest {
	method: string;
	/** Path and query only, e.g. "/chat/abc?x=1". */
	pathname: string;
	search: string;
	host: string | null;
	origin: string | null;
	cookieHeader: string | null;
}

export type AccessDecision =
	| { kind: "allow" }
	/** Set the cookie, then redirect to `location` (the URL without the token). */
	| { kind: "pair"; token: string; location: string }
	| { kind: "deny"; surface: "page" | "api"; reason: string };

/** Token mode: the Electron header mode takes precedence, an unset token is off. */
export function tokenModeOn(env: Env = process.env): boolean {
	if (env.LH_DESKTOP_SERVER === "1") return false;
	return Boolean(env.LH_ACCESS_TOKEN);
}

function safeEqual(supplied: string | null | undefined, expected: string): boolean {
	if (!supplied) return false;
	const a = Buffer.from(supplied);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** The hostname of a Host header value, lower-case, without port: "[::1]:3000" → "[::1]". */
function hostnameOf(host: string): string {
	const h = host.trim().toLowerCase();
	if (h.startsWith("[")) {
		const end = h.indexOf("]");
		return end === -1 ? h : h.slice(0, end + 1);
	}
	const colon = h.lastIndexOf(":");
	return colon === -1 ? h : h.slice(0, colon);
}

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/** Loopback hostnames plus LH_ALLOWED_HOSTS (comma list of hostnames). */
export function hostAllowed(host: string | null, env: Env = process.env): boolean {
	if (!host) return false;
	const extra = (env.LH_ALLOWED_HOSTS ?? "")
		.split(",")
		.map((h) => hostnameOf(h))
		.filter(Boolean);
	return [...LOOPBACK_HOSTS, ...extra].includes(hostnameOf(host));
}

function cookieValue(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
	return null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Does an Origin header name the same site as the Host header? */
function sameOrigin(origin: string, host: string): boolean {
	try {
		return new URL(origin).host.toLowerCase() === host.trim().toLowerCase();
	} catch {
		return false;
	}
}

export function accessDecision(req: AccessRequest, env: Env = process.env): AccessDecision {
	if (!tokenModeOn(env)) return { kind: "allow" };
	const token = env.LH_ACCESS_TOKEN ?? "";
	const surface = req.pathname === "/api" || req.pathname.startsWith("/api/") ? "api" : "page";
	const deny = (reason: string): AccessDecision => ({ kind: "deny", surface, reason });

	if (!hostAllowed(req.host, env)) return deny("host not allowed");
	if (req.pathname === HEALTH_PATH && (req.method === "GET" || req.method === "HEAD")) return { kind: "allow" };
	if (token.length < MIN_TOKEN_LENGTH) return deny("LH_ACCESS_TOKEN is shorter than 32 characters");

	// pairing: a page visit with the right token sets the cookie and drops it from the URL
	if (surface === "page" && (req.method === "GET" || req.method === "HEAD")) {
		const params = new URLSearchParams(req.search);
		if (safeEqual(params.get(PAIR_PARAM), token)) {
			params.delete(PAIR_PARAM);
			const rest = params.toString();
			return { kind: "pair", token, location: req.pathname + (rest ? `?${rest}` : "") };
		}
	}

	if (!safeEqual(cookieValue(req.cookieHeader, ACCESS_COOKIE), token)) {
		return deny("not paired: open the pairing URL printed by the start script");
	}
	if (!SAFE_METHODS.has(req.method)) {
		if (!req.origin) return deny("a write needs an Origin header");
		if (!req.host || !sameOrigin(req.origin, req.host)) return deny("cross-origin write");
	}
	return { kind: "allow" };
}
