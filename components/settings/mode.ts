/**
 * Color-mode primitives shared by the root layout (a server component, so
 * these cannot live in the "use client" appearance provider) and the
 * provider itself.
 */
import type { AppearanceMode } from "@/src/core";

/** What is actually painted: "system" resolved against the OS. */
export type EffectiveMode = "dark" | "light";

/** localStorage key the pre-paint script in app/layout.tsx reads, so a
 *  light-mode user never sees a dark flash while /api/settings loads. */
export const MODE_CACHE_KEY = "lh-mode";

/** Pure: the mode to paint. */
export function effectiveMode(mode: AppearanceMode, systemDark: boolean): EffectiveMode {
	if (mode === "system") return systemDark ? "dark" : "light";
	return mode;
}
