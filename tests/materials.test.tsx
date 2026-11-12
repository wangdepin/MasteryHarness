/**
 * Lesson source material (fork addition, 2026-10-24): the pure core, the
 * on-disk store, the lookup tools (text + the committed PDF fixture), the
 * profiler against a scripted model, the service's refusals, the agent
 * seam, and the Sources pill's render. No network; LH_DATA_DIR isolates.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup as renderBare } from "react-dom/server";
import { InteractionLayersProvider } from "../components/interaction-layers";
// the shared layers need their provider (AppShell mounts it; renders here have no shell)
const renderToStaticMarkup = (node: React.ReactElement) => renderBare(<InteractionLayersProvider>{node}</InteractionLayersProvider>);
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-materials-"));
process.env.LH_DATA_DIR = TMP_DATA;

const core = await import("../src/core/materials.ts");
const { materialStore } = await import("../src/store/materials.ts");
const { materialTools, lineRange } = await import("../src/agent/tools/materials.ts");
const { profileMaterial, splitImageReply } = await import("../src/agent/subagents/material-profiler.ts");
const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { chatStore } = await import("../src/store/chats.ts");
const service = await import("../src/server/materials.ts");
const { MaterialsControl, materialStatusLine, sourcesLabel } = await import("../components/materials-control.tsx");
const { draftMaterials, uploadFiles } = await import("../components/materials-client.ts");

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const FIXTURE_PDF = path.join(import.meta.dirname, "fixtures", "sample-3page.pdf");
const NOTES = "# Kapittel 1: Derivasjon\n\nDefinisjon: den deriverte f'(a) er grensen av differensekvotienten.\n\nOppgave 1.1: Deriver x^2.";

/** Run one tool's execute and return its text. */
async function call(tool: { execute: (...a: never[]) => Promise<unknown> }, args: unknown): Promise<string> {
	const result = (await (tool.execute as (id: string, a: unknown) => Promise<{ content: { text: string }[] }>)("c1", args)) as {
		content: { text: string }[];
	};
	return result.content.map((c) => c.text).join("");
}

describe("the core", () => {
	it("tells kinds apart by extension, then MIME", () => {
		assert.equal(core.materialKindFor("Book.PDF"), "pdf");
		assert.equal(core.materialKindFor("notes.md"), "text");
		assert.equal(core.materialKindFor("page.jpeg"), "image");
		assert.equal(core.materialKindFor("blob", "image/webp"), "image");
		assert.equal(core.materialKindFor("slides.pptx"), null);
		assert.ok(core.isMaterialUrl("https://example.org/a"));
		assert.equal(core.isMaterialUrl("file:///etc/passwd"), false);
	});

	it("the prompt section carries the rules, each profile, and honest statuses", () => {
		assert.equal(core.materialsPromptSection([], () => ""), undefined);
		const base = { kind: "pdf" as const, file: "source.pdf", bytes: 1, addedAt: "t" };
		const section = core.materialsPromptSection(
			[
				{ ...base, id: "mat_a", name: "Kalkulus.pdf", pages: 300, status: "ready", profile: "## Scope and targets\n- derivere (p. 12)" },
				{ ...base, id: "mat_b", name: "Notes.pdf", status: "reading", addedMidLesson: true, addedAt: "2026-02-01T00:00:00Z" },
				{ ...base, id: "mat_c", name: "Broken.pdf", status: "error", error: "encrypted" },
			],
			(m) => `/data/${m.id}/source.pdf`,
			Date.parse("2026-01-01T00:00:00Z"),
		)!;
		assert.match(section, /^<source_material>\n/);
		assert.match(section, /TARGET AND SCOPE/);
		assert.match(section, /you may explain things your own way/);
		assert.match(section, /teach in a different order than the material, as long as all its targets are met/);
		assert.match(section, /Say explicitly when you go beyond the material/);
		assert.match(section, /<material id="mat_a" name="Kalkulus.pdf" kind="PDF, 300 pages" path="\/data\/mat_a\/source.pdf">\n## Scope and targets/);
		assert.match(section, /Still being read/);
		assert.match(section, /could not be built: encrypted/);
		assert.match(section, /Just added by the learner: "Notes.pdf"/);
		assert.match(section, /name="Notes.pdf"[^>]*added="during the lesson"/);
		// once the teacher has answered after the addition, the note is gone
		const later = core.materialsPromptSection(
			[{ ...base, id: "mat_b", name: "Notes.pdf", status: "ready", profile: "P", addedMidLesson: true, addedAt: "2026-02-01T00:00:00Z" }],
			() => "p",
			Date.parse("2026-03-01T00:00:00Z"),
		)!;
		assert.doesNotMatch(later, /Just added/);
	});
});

describe("the store", () => {
	it("stores a copy, indexes it, updates, and removes", () => {
		const m = materialStore.add("chat_store", { kind: "text", name: "notes.md", ext: ".md", bytes: new TextEncoder().encode(NOTES) });
		assert.match(m.id, /^mat_[0-9a-f]{12}$/);
		assert.equal(m.status, "reading");
		assert.equal(fs.readFileSync(materialStore.filePath("chat_store", m), "utf8"), NOTES);
		materialStore.update("chat_store", m.id, { status: "ready", profile: "P" });
		assert.equal(materialStore.list("chat_store")[0]?.profile, "P");
		assert.equal(materialStore.remove("chat_store", m.id), true);
		assert.deepEqual(materialStore.list("chat_store"), []);
		assert.equal(fs.existsSync(path.dirname(materialStore.filePath("chat_store", m))), false);
	});

	it("refuses ids that could walk out of the folder", () => {
		assert.throws(() => materialStore.list("../escape"), /invalid chat id/);
		assert.throws(() => materialStore.auxPath("chat_x", "../../x", "a"), /invalid material id/);
	});
});

describe("the lookup tools", () => {
	const chatId = "chat_tools";
	const text = materialStore.add(chatId, { kind: "text", name: "notes.md", ext: ".md", bytes: new TextEncoder().encode(NOTES) });
	const pdf = materialStore.add(chatId, { kind: "pdf", name: "sample.pdf", ext: ".pdf", bytes: fs.readFileSync(FIXTURE_PDF) });
	const tools = materialTools({ chatId, store: materialStore });

	it("search finds text lines and PDF pages, with the material named", async () => {
		const out = await call(tools.material_search!, { query: "definisjon" });
		assert.match(out, /\[notes.md, line 3\]\n {4}# Kapittel 1[\s\S]*>>> Definisjon/, "context lines, then the hit");
		const pdfOut = await call(tools.material_search!, { query: "force", literal: true });
		assert.match(pdfOut, /\[sample.pdf, p\. 2\]/);
		assert.match(await call(tools.material_search!, { query: "zymurgy" }), /No matches/);
		assert.match(await call(tools.material_search!, { query: "x", material: "nope" }), /No material "nope"/);
	});

	it("read returns PDF pages and numbered text lines", async () => {
		assert.match(await call(tools.material_read!, { material: pdf.id, pages: "2" }), /force/i);
		const lines = await call(tools.material_read!, { material: "notes.md", lines: "5-5" });
		assert.match(lines, /^\[notes.md, lines 5-5 of 5\]\n5: Oppgave 1\.1/);
		assert.deepEqual(lineRange(undefined, 1000), [1, 200]);
		assert.deepEqual(lineRange("10-5", 50), [10, 10]);
		void text;
	});
});

describe("the profiler", () => {
	const engine = (reply: string) => {
		const faux = createFauxCore({});
		faux.setResponses([fauxAssistantMessage(reply)]);
		return { model: faux.getModel(), streamFn: faux.streamSimple };
	};

	it("profiles text with one model call", async () => {
		const file = path.join(TMP_DATA, "p.md");
		fs.writeFileSync(file, NOTES);
		const out = await profileMaterial({ kind: "text", name: "p.md", path: file }, { engine: engine("## Scope and targets\n- derivere") });
		assert.equal(out.profile, "## Scope and targets\n- derivere");
	});

	it("splits an image reply into transcription and profile", async () => {
		assert.deepEqual(splitImageReply("Tekst på tavla\n=== PROFILE ===\n## Scope"), { transcript: "Tekst på tavla", profile: "## Scope" });
		const img = path.join(TMP_DATA, "board.png");
		fs.writeFileSync(img, Buffer.from("89504e470d0a1a0a", "hex"));
		const out = await profileMaterial({ kind: "image", name: "board.png", path: img, mimeType: "image/png" }, { engine: engine("$x^2$\n=== PROFILE ===\n## Notation") });
		assert.equal(out.transcript, "$x^2$");
		assert.equal(out.profile, "## Notation");
	});

	it("the reader's remarks before the first section are trimmed off", async () => {
		const { profileBody } = await import("../src/agent/subagents/material-profiler.ts");
		assert.equal(profileBody("The earlier brief did rest on reading.\n\n## Scope and targets\n- T1"), "## Scope and targets\n- T1");
		assert.equal(profileBody("No headings at all."), "No headings at all.");
	});

	it("an empty text is refused, not profiled", async () => {
		const file = path.join(TMP_DATA, "empty.md");
		fs.writeFileSync(file, "  \n");
		await assert.rejects(profileMaterial({ kind: "text", name: "empty.md", path: file }, { engine: engine("x") }), /empty/);
	});
});

describe("the service", () => {
	it("refuses unknown lessons and unsupported files", () => {
		assert.equal(service.addUploadedMaterial("chat_missing", { name: "a.pdf", type: "", bytes: new Uint8Array(1) }).ok, false);
		const chat = chatStore.createChat("Materials");
		const bad = service.addUploadedMaterial(chat.id, { name: "deck.pptx", type: "", bytes: new Uint8Array(1) });
		assert.equal(bad.ok, false);
		assert.equal(bad.ok ? 0 : bad.status, 415);
	});

	it("without a vision model the read fails honestly — the file still serves the tools", async () => {
		const chat = chatStore.createChat("No vision");
		const added = service.addUploadedMaterial(chat.id, { name: "notes.md", type: "text/markdown", bytes: new TextEncoder().encode(NOTES) });
		assert.ok(added.ok);
		await service.waitForMaterials(chat.id, 5000);
		const [m] = service.listMaterials(chat.id);
		assert.equal(m?.status, "error");
		assert.match(m?.error ?? "", /no vision model is configured/);
		const turn = service.materialsForTurn(chat.id)!;
		assert.match(turn.section, /could not be built/);
		assert.deepEqual(turn.tools.map((t) => t.name).sort(), ["material_read", "material_search"]);
		assert.equal(added.ok && added.value.addedMidLesson, undefined, "a lesson with no turns yet: not mid-lesson");
	});
});

describe("the agent seam", () => {
	it("the section joins the prompt and the tools join the registry", () => {
		const faux = createFauxCore({});
		const agent = createTeacherAgent(undefined, {
			engine: { model: faux.getModel(), streamFn: faux.streamSimple },
			materials: { section: "<source_material>\nSECTION\n</source_material>", tools: Object.values(materialTools({ chatId: "chat_tools", store: materialStore })) },
		});
		assert.ok(agent.state.systemPrompt.includes("\n\n<source_material>\nSECTION\n</source_material>"));
		assert.ok(agent.state.tools.some((t) => t.name === "material_search"));
	});
});

describe("the Sources pill", () => {
	it("labels and status lines", () => {
		assert.equal(sourcesLabel(0, 0), "Sources");
		assert.equal(sourcesLabel(2, 0), "Sources · 2");
		assert.equal(sourcesLabel(2, 1), "Reading 1…");
		const m = { id: "mat_x", kind: "pdf" as const, name: "b.pdf", file: "source.pdf", bytes: 1, addedAt: "t" };
		assert.equal(materialStatusLine({ ...m, status: "ready", pages: 12 }), "12 pages");
		assert.equal(materialStatusLine({ ...m, status: "reading" }), "reading…");
		assert.equal(materialStatusLine({ ...m, status: "error", error: "encrypted" }), "not read — encrypted");
	});

	it("renders in draft mode with the draft's count", () => {
		draftMaterials.clear();
		assert.match(renderToStaticMarkup(<MaterialsControl />), /data-testid="stats-materials"[\s\S]*Sources</);
	});
});

describe("uploadFiles (one file per request, 2026-10-25)", () => {
	/** A fetch fake: records each request's file names; `fail` names get a 415. */
	function fakeFetch(fail: string[] = []) {
		const sent: string[][] = [];
		const fetchLike = (async (_url: string, init: { body: FormData }) => {
			const names = init.body.getAll("file").map((f) => (f as File).name);
			sent.push(names);
			return names.some((n) => fail.includes(n))
				? Response.json({ error: `${names[0]} is not a supported type` }, { status: 415 })
				: Response.json({ materials: [] }, { status: 201 });
		}) as unknown as typeof fetch;
		return { sent, fetchLike };
	}
	const file = (name: string) => new File(["x"], name);

	it("sends each file in its own request", async () => {
		const { sent, fetchLike } = fakeFetch();
		assert.equal(await uploadFiles("chat_x", [file("a.pdf"), file("b.pdf")], fetchLike), null);
		assert.deepEqual(sent, [["a.pdf"], ["b.pdf"]]);
	});

	it("refuses a file over the ceiling without sending it, and still sends the rest", async () => {
		const big = file("huge.pdf");
		Object.defineProperty(big, "size", { value: core.MATERIAL_MAX_BYTES + 1 });
		const { sent, fetchLike } = fakeFetch();
		assert.equal(await uploadFiles("chat_x", [big, file("ok.pdf")], fetchLike), "huge.pdf is larger than 100 MB");
		assert.deepEqual(sent, [["ok.pdf"]]);
	});

	it("reports every failure and keeps going past one", async () => {
		const { sent, fetchLike } = fakeFetch(["a.exe", "c.exe"]);
		const error = await uploadFiles("chat_x", [file("a.exe"), file("b.pdf"), file("c.exe")], fetchLike);
		assert.equal(error, "a.exe is not a supported type; c.exe is not a supported type");
		assert.equal(sent.length, 3);
	});
});
