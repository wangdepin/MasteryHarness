import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachmentName, exportSessionMarkdown, markdownUrl, type ExportDevice } from "../components/phone/export-session.ts";
import { shareFile, type ShareSurface } from "../components/phone/share-file.ts";

const file = new File(["# notes"], "notes.md", { type: "text/markdown" });
const named = (name: string) => Object.assign(new Error(name), { name });

describe("shareFile", () => {
	it("hands the file to the share sheet where the device can share files", async () => {
		const shared: File[][] = [];
		const surface: ShareSurface = { canShare: () => true, share: async (data) => { shared.push(data.files); } };
		assert.equal(await shareFile(file, surface), true);
		assert.deepEqual(shared, [[file]]);
	});

	it("a sheet the person closes is handled: nothing else happens", async () => {
		assert.equal(await shareFile(file, { canShare: () => true, share: async () => { throw named("AbortError"); } }), true);
	});

	it("reports false where sharing is absent, cannot take files, or is refused", async () => {
		assert.equal(await shareFile(file, {}), false);
		assert.equal(await shareFile(file, { share: async () => {} }), false, "no canShare: files are not supported");
		assert.equal(await shareFile(file, { canShare: () => false, share: async () => {} }), false);
		assert.equal(await shareFile(file, { canShare: () => true, share: async () => { throw named("NotAllowedError"); } }), false);
	});
});

describe("attachmentName", () => {
	it("reads the export route's filename, and has a fallback", () => {
		assert.equal(attachmentName('attachment; filename="linear-algebra.md"'), "linear-algebra.md");
		assert.equal(attachmentName(null), "session.md");
		assert.equal(attachmentName("attachment"), "session.md");
	});
});

describe("exportSessionMarkdown", () => {
	function device(over: Partial<ExportDevice> = {}) {
		const log = { downloads: [] as string[], fetched: [] as string[], shared: [] as string[] };
		const exportDevice: ExportDevice = {
			touch: true,
			share: { canShare: () => true, share: async (data) => { log.shared.push(data.files[0]!.name); } },
			fetch: (async (input: RequestInfo | URL) => {
				log.fetched.push(String(input));
				return new Response("# notes", { headers: { "content-disposition": 'attachment; filename="notes.md"' } });
			}) as typeof fetch,
			download: (url) => { log.downloads.push(url); },
			...over,
		};
		return { log, exportDevice };
	}
	const url = markdownUrl("chat_1");

	it("a desktop downloads, as it always has, without fetching first", async () => {
		const { log, exportDevice } = device({ touch: false });
		await exportSessionMarkdown("chat_1", exportDevice);
		assert.deepEqual(log, { downloads: [url], fetched: [], shared: [] });
	});

	it("a phone shares the file under the route's name", async () => {
		const { log, exportDevice } = device();
		await exportSessionMarkdown("chat_1", exportDevice);
		assert.deepEqual(log, { downloads: [], fetched: [url], shared: ["notes.md"] });
	});

	it("a phone that cannot share downloads instead", async () => {
		const none = device({ share: {} });
		await exportSessionMarkdown("chat_1", none.exportDevice);
		assert.deepEqual(none.log, { downloads: [url], fetched: [], shared: [] });

		const refused = device({ share: { canShare: () => true, share: async () => { throw named("NotAllowedError"); } } });
		await exportSessionMarkdown("chat_1", refused.exportDevice);
		assert.deepEqual(refused.log.downloads, [url]);
	});

	it("a failed read downloads, so the browser shows its own error", async () => {
		const missing = device({ fetch: (async () => new Response("no", { status: 404 })) as typeof fetch });
		await exportSessionMarkdown("chat_1", missing.exportDevice);
		assert.deepEqual(missing.log, { downloads: [url], fetched: [], shared: [] });

		const offline = device({ fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch });
		await exportSessionMarkdown("chat_1", offline.exportDevice);
		assert.deepEqual(offline.log.downloads, [url]);
	});

	it("the session id is escaped into the path", () => {
		assert.equal(markdownUrl("a/b"), "/api/chats/a%2Fb/markdown");
	});
});
