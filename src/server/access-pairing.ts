import { createHash, timingSafeEqual } from "node:crypto";
import { accessCookieHeader, mintAccessCookie } from "./access-cookie.ts";
import { isApiPath } from "./access-fetch-metadata.ts";
import { withSecurityHeaders } from "./access-headers.ts";
import { pairingBlocked, recordPairingFailure } from "./access-pairing-limiter.ts";
import { pairingPage, type PairingProblem } from "./access-pairing-page.ts";
import { accessToken, gateMode } from "./access-token.ts";

/**
 * The pairing form's handler: the one place a browser trades the access
 * token for the paired cookie. The proxy has already checked Host and Origin
 * by the time a request arrives here.
 */

type Env = Record<string, string | undefined>;

/** A pasted token plus form overhead is a few hundred bytes. */
const MAX_FORM_BYTES = 4096;
const PLACEHOLDER_ORIGIN = "http://pairing.invalid";

/** Where to send the browser after pairing: a path on this site, never the API and never another site. */
export function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
	let url: URL;
	try {
		url = new URL(raw, PLACEHOLDER_ORIGIN);
	} catch {
		return "/";
	}
	if (url.origin !== PLACEHOLDER_ORIGIN || isApiPath(url.pathname)) return "/";
	return url.pathname + url.search;
}

function digest(text: string): Buffer {
	return createHash("sha256").update(text.trim().toLowerCase()).digest();
}

/** Constant-time, and tolerant of the case and stray whitespace a paste can add. */
function tokenMatches(supplied: string | null, expected: string): boolean {
	if (!supplied) return false;
	return timingSafeEqual(digest(supplied), digest(expected));
}

async function readForm(request: Request): Promise<URLSearchParams> {
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_FORM_BYTES) return new URLSearchParams();
	const body = await request.text();
	return new URLSearchParams(body.length > MAX_FORM_BYTES ? "" : body);
}

function formAgain(status: 403 | 429, next: string, problem: PairingProblem): Response {
	const headers = withSecurityHeaders({ "Content-Type": "text/html; charset=utf-8" });
	return new Response(pairingPage({ next, problem }), { status, headers });
}

function paired(next: string, token: string, host: string | null, nowMs: number): Response {
	const cookie = accessCookieHeader(mintAccessCookie(token, nowMs), host);
	// A relative Location: no scheme or host is derived from the request.
	return new Response(null, { status: 303, headers: withSecurityHeaders({ Location: next, "Set-Cookie": cookie }) });
}

export async function pairingResponse(request: Request, env: Env = process.env, nowMs: number = Date.now()): Promise<Response> {
	if (gateMode(env) !== "on") return new Response(null, { status: 404 });
	const form = await readForm(request);
	const next = safeNext(form.get("next"));
	if (pairingBlocked(nowMs)) return formAgain(429, next, "too-many-attempts");
	if (!tokenMatches(form.get("token"), accessToken(env))) {
		recordPairingFailure(nowMs);
		return formAgain(403, next, "wrong-token");
	}
	return paired(next, accessToken(env), request.headers.get("host"), nowMs);
}
