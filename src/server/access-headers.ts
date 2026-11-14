import { isApiPath } from "./access-fetch-metadata.ts";

/** Sent with every response the gate lets through or produces. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "same-origin",
	"X-Content-Type-Options": "nosniff",
});

const NEVER_STORED = "private, no-store";
const BUNDLED_FONT = "private, max-age=31536000, immutable";

/**
 * The Cache-Control the gate adds to a passing request, if any.
 *
 * Pages hold lesson text, so no cache may keep them. API routes are left
 * alone: each sets its own policy, and the event streams rely on theirs
 * (`no-transform`) to stay uncompressed and unbuffered.
 */
export function cachePolicy(pathname: string): string | undefined {
	if (isApiPath(pathname)) return undefined;
	return pathname.startsWith("/fonts/") ? BUNDLED_FONT : NEVER_STORED;
}

export function withSecurityHeaders(headers: Record<string, string> = {}): Record<string, string> {
	return { ...SECURITY_HEADERS, "Cache-Control": NEVER_STORED, ...headers };
}
