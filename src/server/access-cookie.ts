import { createHmac, timingSafeEqual } from "node:crypto";
import { isLoopbackHost } from "./access-host.ts";

/**
 * The paired-device cookie.
 *
 * Its value is an expiry signed with the access token, never the token
 * itself, and the server keeps no record of it. Changing the token therefore
 * signs every device out at once; there is no per-device revocation.
 */

export const ACCESS_COOKIE = "lh_access";
/** How long a paired browser stays paired: the lifetime cap browsers apply to cookies. */
export const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

const VERSION = "v1";

function signature(token: string, expiry: number): Buffer {
	return createHmac("sha256", token).update(`lh-access.${VERSION}.${expiry}`).digest();
}

export function mintAccessCookie(token: string, nowMs: number): string {
	const expiry = Math.floor(nowMs / 1000) + COOKIE_MAX_AGE_S;
	return `${VERSION}.${expiry}.${signature(token, expiry).toString("base64url")}`;
}

export function accessCookieValid(value: string | null, token: string, nowMs: number): boolean {
	if (!value) return false;
	const [version, rawExpiry, rawSignature, ...rest] = value.split(".");
	if (version !== VERSION || !rawExpiry || !rawSignature || rest.length > 0) return false;
	if (!/^\d{1,12}$/.test(rawExpiry)) return false;
	const expiry = Number(rawExpiry);
	if (expiry * 1000 <= nowMs) return false;
	const supplied = Buffer.from(rawSignature, "base64url");
	const expected = signature(token, expiry);
	return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** One cookie's value out of a Cookie request header. */
export function cookieValue(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
	return null;
}

/** `Secure` everywhere but loopback, where the Mac's own browser speaks plain HTTP. */
export function accessCookieHeader(value: string, host: string | null): string {
	const attributes = [`${ACCESS_COOKIE}=${value}`, "Path=/", `Max-Age=${COOKIE_MAX_AGE_S}`, "HttpOnly", "SameSite=Strict"];
	if (!host || !isLoopbackHost(host)) attributes.push("Secure");
	return attributes.join("; ");
}
