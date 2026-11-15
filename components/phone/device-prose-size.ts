"use client";

/**
 * THE READING SIZE ON THIS DEVICE (docs/phone.md): a phone can read at its
 * own size while the Mac keeps the shared Settings → Appearance → Reading
 * font size. It lives in this browser's localStorage, and absent, the shared
 * size applies. AppearanceProvider (components/settings/appearance.tsx) puts
 * it in place of the shared --lh-prose-size.
 */
import { useSyncExternalStore } from "react";
import { PROSE_FONT_MAX, PROSE_FONT_MIN } from "@/src/core";

export const DEVICE_PROSE_SIZE_KEY = "lh:device-prose-size";

type SizeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A stored size, when it is one the shared setting would also hold: whole px within the range. */
function storedSize(raw: string | null): number | null {
	if (raw === null || !/^\d+$/.test(raw)) return null;
	const size = Number(raw);
	return size >= PROSE_FONT_MIN && size <= PROSE_FONT_MAX ? size : null;
}

/**
 * What the size field's text asks for: null clears it, undefined is not a
 * size. Rounded and held to the range, as the shared field does.
 */
export function proseSizeFromInput(text: string): number | null | undefined {
	if (text.trim() === "") return null;
	const size = Number(text);
	if (!Number.isFinite(size)) return undefined;
	return Math.min(PROSE_FONT_MAX, Math.max(PROSE_FONT_MIN, Math.round(size)));
}

/** The appearance variables with this device's size in place of the shared one. */
export function withDeviceProseSize(vars: Record<string, string>, size: number | null): Record<string, string> {
	return size === null ? vars : { ...vars, "--lh-prose-size": `${size}px` };
}

/** The size and its readers, over whatever storage the browser gives (none in a private window that blocks it). */
export function createDeviceProseSizeStore(storage: () => SizeStorage | null) {
	const listeners = new Set<() => void>();
	const write = (size: number | null) => {
		const target = storage();
		if (!target) return false;
		if (size === null) target.removeItem(DEVICE_PROSE_SIZE_KEY);
		else target.setItem(DEVICE_PROSE_SIZE_KEY, String(size));
		return true;
	};
	return {
		getSnapshot(): number | null {
			try {
				return storedSize(storage()?.getItem(DEVICE_PROSE_SIZE_KEY) ?? null);
			} catch {
				return null;
			}
		},
		getServerSnapshot: (): number | null => null,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		/** False when the browser would not keep it; the size stays as it was. */
		save(size: number | null): boolean {
			try {
				if (!write(size)) return false;
			} catch {
				return false;
			}
			for (const listener of listeners) listener();
			return true;
		},
	};
}

const store = createDeviceProseSizeStore(() => (typeof localStorage === "undefined" ? null : localStorage));

/** This device's reading size, or null to use the shared one. */
export function useDeviceProseSize(): number | null {
	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

export const saveDeviceProseSize = store.save;
