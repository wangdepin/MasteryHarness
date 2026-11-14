/**
 * Host and Origin rules of the access gate.
 *
 * Nothing here reads a forwarded header. A reverse proxy such as Tailscale
 * Serve passes the client's own Host through, so a loopback Host proves
 * nothing about where the request came from: it only decides which scheme
 * the browser must have used.
 */

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

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

export function isLoopbackHost(host: string): boolean {
	return LOOPBACK_HOSTS.includes(hostnameOf(host));
}

/** Loopback hostnames plus LH_ALLOWED_HOSTS (comma list of hostnames). */
export function hostAllowed(host: string | null, env: Env = process.env): boolean {
	if (!host) return false;
	const extra = (env.LH_ALLOWED_HOSTS ?? "")
		.split(",")
		.map((h) => hostnameOf(h))
		.filter(Boolean);
	return [...LOOPBACK_HOSTS, ...extra].includes(hostnameOf(host));
}

function originOf(scheme: "http" | "https", host: string): string | null {
	try {
		return new URL(`${scheme}://${host.trim()}`).origin;
	} catch {
		return null;
	}
}

/** The origins a browser addressing `host` may send: HTTPS anywhere, plain HTTP on loopback only. */
export function expectedOrigins(host: string): string[] {
	const schemes = isLoopbackHost(host) ? (["http", "https"] as const) : (["https"] as const);
	return schemes.map((scheme) => originOf(scheme, host)).filter((origin): origin is string => origin !== null);
}

/** Does an Origin header name the site the request was addressed to? */
export function originMatchesHost(origin: string | null, host: string | null): boolean {
	if (!origin || !host) return false;
	let supplied: string;
	try {
		supplied = new URL(origin).origin;
	} catch {
		return false;
	}
	return expectedOrigins(host).includes(supplied);
}
