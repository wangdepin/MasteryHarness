import { NextResponse, type NextRequest } from "next/server";
import { isApiPath } from "./src/server/access-fetch-metadata.ts";
import { accessDecision, accessRequestOf, type AccessDecision } from "./src/server/access-gate.ts";
import { SECURITY_HEADERS, cachePolicy, withSecurityHeaders } from "./src/server/access-headers.ts";
import { pairingPage } from "./src/server/access-pairing-page.ts";
import { gateMode } from "./src/server/access-token.ts";
import { shellRequestRefusal } from "./src/server/desktop-access.ts";

const HTML = "text/html; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";

function passThrough(pathname: string): NextResponse {
	const response = NextResponse.next();
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	const cache = cachePolicy(pathname);
	if (cache) response.headers.set("Cache-Control", cache);
	return response;
}

function gateResponse(pathname: string, decision: AccessDecision): NextResponse {
	if (decision.kind === "allow") return passThrough(pathname);
	if (decision.kind === "pair") {
		return new NextResponse(pairingPage({ next: decision.next }), { status: 403, headers: withSecurityHeaders({ "Content-Type": HTML }) });
	}
	if (decision.surface === "api") {
		return NextResponse.json({ error: decision.reason }, { status: decision.status, headers: withSecurityHeaders() });
	}
	return new NextResponse(decision.reason, { status: decision.status, headers: withSecurityHeaders({ "Content-Type": TEXT }) });
}

/** Every API method, including SSE and spending/settings routes, is checked by shellRequestRefusal: the Electron
 * capability when the desktop shell runs the server, the browser Host and cross-site rules otherwise. No public
 * callback or worker bypass: internal jobs call server functions, and any legitimate self-HTTP request must carry
 * the private capability. The one streamed document route enforces the identical policy inside its handler
 * (createPluginDocumentRoute), avoiding Next's silently truncated Proxy body clone.
 *
 * With LH_ACCESS_TOKEN set, the access gate (access-gate.ts) then applies to pages and the API alike: the paired
 * cookie, the stricter Host and Origin rules, and the pairing form for a browser that has no cookie yet. With it
 * unset, this function adds nothing to a response. */
export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;
	if (isApiPath(pathname)) {
		const refusal = shellRequestRefusal(request);
		if (refusal) return NextResponse.json({ error: refusal }, { status: 403, headers: { "Cache-Control": "no-store" } });
	}
	if (gateMode() === "off") return NextResponse.next();
	return gateResponse(pathname, accessDecision(accessRequestOf(request)));
}

/** Everything but the build's own static assets (pages need the gate too) and the one streamed plugin document
 * route, which applies the same policy itself. Must remain a static literal. */
export const config = { matcher: "/((?!_next/static|favicon.ico|api/plugins/[^/]+/documents/markdown/?$).*)" };
