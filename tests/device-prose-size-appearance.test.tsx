import React, { act } from "react";
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";
import { BUILTIN_THEMES, DEFAULT_THEME } from "../src/core/index.ts";
import { AppearanceProvider, useAppearance } from "../components/settings/appearance.tsx";
import { DEVICE_PROSE_SIZE_KEY, saveDeviceProseSize } from "../components/phone/device-prose-size.ts";

(globalThis as Record<string, unknown>).React = React;

it("this device's reading size takes the shared one's place on <html>, and clearing it brings the shared one back", async () => {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	const items = new Map([[DEVICE_PROSE_SIZE_KEY, "21"]]);
	const globals = {
		window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
		localStorage: {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => void items.set(key, value),
			removeItem: (key: string) => void items.delete(key),
		},
		fetch: async () => Response.json({ themes: BUILTIN_THEMES }),
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(document.getElementById("root")!);
	let live!: ReturnType<typeof useAppearance>;
	function Probe() { live = useAppearance(); return null; }
	const proseSize = () => document.documentElement.style.getPropertyValue("--lh-prose-size");
	try {
		await act(async () => root.render(
			<AppearanceProvider initialAppearance={{ proseFontSize: 18 }} initialTheme={DEFAULT_THEME}><Probe /></AppearanceProvider>,
		));
		assert.equal(proseSize(), "21px");
		await act(async () => live.onAppearanceChange({ proseFontSize: 16 }));
		assert.equal(proseSize(), "21px", "a change to the shared size leaves this device's size in place");
		await act(async () => void saveDeviceProseSize(19));
		assert.equal(proseSize(), "19px");
		await act(async () => void saveDeviceProseSize(null));
		assert.equal(proseSize(), "16px");
		assert.equal(items.has(DEVICE_PROSE_SIZE_KEY), false);
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
	}
});
