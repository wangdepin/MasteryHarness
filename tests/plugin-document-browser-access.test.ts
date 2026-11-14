import assert from "node:assert/strict";
import { it } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";
import { createPluginDocumentRoute } from "../src/server/plugin-transport.ts";

it("streamed document route shares browser policy before params, plugin work or multipart body access", async t => {
	const keys = ["LH_DESKTOP_SERVER", "LH_DESKTOP_API_SECRET", "LH_ALLOWED_HOSTS"] as const;
	const saved = keys.map(key => process.env[key]);
	for (const key of keys) delete process.env[key];
	try {
		const convert = t.mock.fn(async () => Response.json({ markdown: "owned fixture" }));
		const route = createPluginDocumentRoute({ convertDocument: convert });
		const methods = ["POST", "GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"] as const;
		for (const method of methods) {
			const cases: { host: string; origin: string | undefined; site: string | undefined }[] = [{ host: "rebind.invalid", origin: undefined, site: undefined }];
			if (!["GET", "HEAD", "OPTIONS"].includes(method)) cases.push(
				{ host: "localhost", origin: "https://other.invalid", site: "cross-site" },
				{ host: "localhost", origin: "null", site: "cross-site" },
			);
			for (const { host, origin, site } of cases) {
				const headers: Record<string, string> = { host, "content-type": "multipart/form-data; boundary=owned" };
				if (origin) headers.origin = origin;
				if (site) headers["sec-fetch-site"] = site;
				const url = `http://${host}/api/plugins/document-one/documents/markdown`;
				const request = new Request(url, { method, headers });
				let bodyAccesses = 0, paramsAccesses = 0;
				Object.defineProperty(request, "body", { get() { bodyAccesses++; throw new Error("body accessed before policy"); } });
				const context = { get params(): Promise<{ id: string }> { paramsAccesses++; throw new Error("params accessed before policy"); } };
				const response = method === "POST" ? await route.POST(request, context) : await route[method](request);
				const control = proxy(new NextRequest(url, { method, headers }));
				assert.equal(response.status, 403, `${method}: ${host} ${origin}`);
				assert.equal(response.headers.get("cache-control"), "no-store");
				assert.deepEqual(await response.json(), await control.json());
				assert.equal(bodyAccesses, 0);
				assert.equal(paramsAccesses, 0);
				assert.equal(request.bodyUsed, false);
			}
		}
		assert.equal(convert.mock.callCount(), 0);
		const form = new FormData(); form.append("file", new File(["owned fixture"], "small.txt"));
		const post = new Request("http://localhost/api/plugins/document-one/documents/markdown", {
			method: "POST", headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" }, body: form,
		});
		assert.equal((await route.POST(post, { params: Promise.resolve({ id: "document-one" }) })).status, 200);
		assert.equal(convert.mock.callCount(), 1);
		assert.equal(post.bodyUsed, false, "authorized route forwards the original stream");
	} finally {
		keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
	}
});

it("token mode (LH_ACCESS_TOKEN): the streamed route, exempt from Proxy, still needs the pairing cookie", async t => {
	const keys = ["LH_DESKTOP_SERVER", "LH_DESKTOP_API_SECRET", "LH_ALLOWED_HOSTS", "LH_ACCESS_TOKEN"] as const;
	const saved = keys.map(key => process.env[key]);
	for (const key of keys) delete process.env[key];
	const token = "t".repeat(40);
	process.env.LH_ACCESS_TOKEN = token;
	try {
		const convert = t.mock.fn(async () => Response.json({ markdown: "owned fixture" }));
		const route = createPluginDocumentRoute({ convertDocument: convert });
		const url = "http://127.0.0.1:3000/api/plugins/document-one/documents/markdown";
		const headers = (cookie?: string): Record<string, string> => ({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}) });
		const context = { params: Promise.resolve({ id: "document-one" }) };
		const form = () => { const f = new FormData(); f.append("file", new File(["x"], "small.txt")); return f; };

		const unpaired = await route.POST(new Request(url, { method: "POST", headers: headers(), body: form() }), context);
		assert.equal(unpaired.status, 403, "no cookie: refused before the plugin runs");
		assert.match(((await unpaired.json()) as { error: string }).error, /not paired/);
		const wrong = await route.POST(new Request(url, { method: "POST", headers: headers("lh_token=wrong"), body: form() }), context);
		assert.equal(wrong.status, 403, "a wrong cookie is refused too");
		assert.equal(convert.mock.callCount(), 0);

		const paired = await route.POST(new Request(url, { method: "POST", headers: headers(`lh_token=${token}`), body: form() }), context);
		assert.equal(paired.status, 200, "the paired browser reaches the conversion");
		assert.equal(convert.mock.callCount(), 1);

		const otherHost = await route.POST(new Request(url, { method: "POST", headers: { ...headers(`lh_token=${token}`), host: "192.168.1.5:3000" }, body: form() }), context);
		assert.equal(otherHost.status, 403, "token mode keeps its stricter Host rule (loopback + LH_ALLOWED_HOSTS) on this route too");
	} finally {
		keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
	}
});
