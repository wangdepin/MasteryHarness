/**
 * What a browser fetches without cookies when the site is added to a home
 * screen: the web app manifest and the icons it and <head> name. Gated,
 * "Add to Home Screen" would lose the icon and the standalone window. None
 * of these files holds anything about the learner.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/manifest.webmanifest", "/apple-icon.png", "/icon-192.png", "/icon-512.png"]);

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.has(pathname);
}
