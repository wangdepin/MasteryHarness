import type { MetadataRoute } from "next";

/** The squircle of the app icon, and the Default theme's background. */
const ICON_BACKGROUND = "#141414";

/**
 * The web app manifest: what "Add to Home Screen" reads (docs/phone.md).
 * The icons are written by scripts/make-web-app-icons.mjs. There is no
 * service worker: the app needs its server.
 */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "MasteryHarness",
		short_name: "Mastery",
		start_url: "/",
		scope: "/",
		display: "standalone",
		background_color: ICON_BACKGROUND,
		theme_color: ICON_BACKGROUND,
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
	};
}
