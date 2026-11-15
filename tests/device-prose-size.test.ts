import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEVICE_PROSE_SIZE_KEY,
	createDeviceProseSizeStore,
	proseSizeFromInput,
	withDeviceProseSize,
} from "../components/phone/device-prose-size.ts";

function memoryStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		removeItem: (key: string) => void items.delete(key),
	};
}

const blockedStorage = {
	getItem(): string | null {
		throw new Error("SecurityError");
	},
	setItem() {
		throw new Error("QuotaExceededError");
	},
	removeItem() {
		throw new Error("SecurityError");
	},
};

describe("the reading size on this device", () => {
	it("is read from this browser's storage, and only a size the shared setting would hold counts", () => {
		const cases: [string | undefined, number | null][] = [
			["20", 20], ["12", 12], ["24", 24],
			["11", null], ["25", null], ["18.5", null], ["-16", null], ["big", null], ["", null], [undefined, null],
		];
		for (const [stored, size] of cases) {
			const storage = memoryStorage(stored === undefined ? {} : { [DEVICE_PROSE_SIZE_KEY]: stored });
			assert.equal(createDeviceProseSizeStore(() => storage).getSnapshot(), size, `stored ${JSON.stringify(stored)}`);
		}
	});

	it("is absent when there is no storage or it cannot be read", () => {
		assert.equal(createDeviceProseSizeStore(() => null).getSnapshot(), null);
		assert.equal(createDeviceProseSizeStore(() => blockedStorage).getSnapshot(), null);
	});

	it("is absent before the page runs in a browser", () => {
		assert.equal(createDeviceProseSizeStore(() => memoryStorage({ [DEVICE_PROSE_SIZE_KEY]: "20" })).getServerSnapshot(), null);
	});

	it("saves and clears, and tells every reader each time", () => {
		const storage = memoryStorage();
		const store = createDeviceProseSizeStore(() => storage);
		let told = 0;
		const stop = store.subscribe(() => told++);
		assert.equal(store.save(21), true);
		assert.equal(storage.items.get(DEVICE_PROSE_SIZE_KEY), "21");
		assert.equal(store.getSnapshot(), 21);
		assert.equal(store.save(null), true);
		assert.equal(storage.items.has(DEVICE_PROSE_SIZE_KEY), false);
		assert.equal(store.getSnapshot(), null);
		assert.equal(told, 2);
		stop();
		store.save(20);
		assert.equal(told, 2);
	});

	it("a browser that will not keep it refuses the save and leaves the size as it was", () => {
		for (const storage of [null, blockedStorage]) {
			const store = createDeviceProseSizeStore(() => storage);
			let told = 0;
			store.subscribe(() => told++);
			assert.equal(store.save(20), false);
			assert.equal(store.getSnapshot(), null);
			assert.equal(told, 0);
		}
	});

	it("typed text: empty clears it, a number is rounded and held to 12–24 like the shared field, anything else is refused", () => {
		assert.equal(proseSizeFromInput(""), null);
		assert.equal(proseSizeFromInput("  "), null);
		assert.equal(proseSizeFromInput("20"), 20);
		assert.equal(proseSizeFromInput("17.6"), 18);
		assert.equal(proseSizeFromInput("30"), 24);
		assert.equal(proseSizeFromInput("8"), 12);
		assert.equal(proseSizeFromInput("big"), undefined);
	});

	it("takes the place of the shared reading size and of nothing else", () => {
		const shared = { "--lh-prose-size": "18px", "--background": "#141414" };
		assert.deepEqual(withDeviceProseSize(shared, 21), { "--lh-prose-size": "21px", "--background": "#141414" });
		assert.equal(withDeviceProseSize(shared, null), shared);
		assert.deepEqual(shared, { "--lh-prose-size": "18px", "--background": "#141414" });
	});
});
