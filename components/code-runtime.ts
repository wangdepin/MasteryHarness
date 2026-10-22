import type { CodeLanguage, CodeRuntime } from "@/src/core";
import { createBrowserPythonRuntime } from "@/components/python-runtime-iframe";

/**
 * TEMPORARY (B4): Pyodide is fetched from jsDelivr at this pinned version.
 * B5 replaces it with a distribution bundled into the app (offline, packaged
 * Electron); this constant is the only place the URL lives.
 */
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

const runtimes = new Map<CodeLanguage, CodeRuntime>();

/** The shared runtime for a language. One per page: the Pyodide download and
 *  its worker are created on the first run and reused by every exercise. */
export function codeRuntimeFor(language: CodeLanguage): CodeRuntime {
	let runtime = runtimes.get(language);
	if (!runtime) {
		runtime = createBrowserPythonRuntime(PYODIDE_INDEX_URL);
		runtimes.set(language, runtime);
	}
	return runtime;
}
