/**
 * The Fetch Metadata rule of the access gate.
 *
 * A browser labels every request with where it came from. Requests another
 * site makes on the reader's behalf are refused, with one exception: opening
 * the app as a page. Some mobile browsers label their start and restore
 * pages as cross-site, and a page load gives the other site nothing to read.
 */

export interface FetchMetadata {
	site: string | null;
	mode: string | null;
	dest: string | null;
}

export function isApiPath(pathname: string): boolean {
	return pathname === "/api" || pathname.startsWith("/api/");
}

function isPageLoad(method: string, pathname: string, metadata: FetchMetadata): boolean {
	if (method !== "GET" && method !== "HEAD") return false;
	return metadata.mode === "navigate" && metadata.dest === "document" && !isApiPath(pathname);
}

/** True when another site is behind the request. Clients that send no metadata are judged elsewhere. */
export function crossSiteRequest(method: string, pathname: string, metadata: FetchMetadata): boolean {
	if (metadata.site === null || metadata.site === "same-origin" || metadata.site === "none") return false;
	return !isPageLoad(method, pathname, metadata);
}
