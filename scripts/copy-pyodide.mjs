// Copies the Pyodide runtime files the code-exercise runner loads from the
// pinned npm package into public/pyodide/ — the app serves them itself
// (dev server, Electron's standalone server), never from a CDN. Runs on
// `npm install` (postinstall); public/pyodide/ is gitignored. The package
// is a devDependency: a production-only install skips quietly, and
// scripts/build-server.mjs refuses to package a build without the files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FROM = path.join(ROOT, "node_modules", "pyodide");
const TO = path.join(ROOT, "public", "pyodide");

/** The runtime's files — core only (no packages: NumPy is not bundled). */
export const PYODIDE_FILES = [
	"pyodide.mjs",
	"pyodide.asm.mjs",
	"pyodide.asm.wasm",
	"python_stdlib.zip",
	"pyodide-lock.json",
];

if (!fs.existsSync(FROM)) {
	console.log("[copy-pyodide] node_modules/pyodide not installed — skipping.");
	process.exit(0);
}
fs.mkdirSync(TO, { recursive: true });
for (const file of PYODIDE_FILES) {
	fs.copyFileSync(path.join(FROM, file), path.join(TO, file));
}
console.log(`[copy-pyodide] ${PYODIDE_FILES.length} files → public/pyodide/`);
