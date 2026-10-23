import type { CodeLanguage, CodeRunRequest, CodeRunResult, CodeRuntime } from "@/src/core";
import { createBrowserPythonRuntime } from "@/components/python-runtime-iframe";

/** Pyodide ships with the app: public/pyodide/ (scripts/copy-pyodide.mjs),
 *  served by the app's own server. Absolute, because the runner's worker
 *  lives in an opaque-origin iframe where a relative URL resolves to nothing. */
const pyodideIndexUrl = (): string => `${window.location.origin}/pyodide/`;

const runtimes = new Map<CodeLanguage, CodeRuntime>();

/** The shared runtime for a language. One per page: the Pyodide download and
 *  its worker are created on the first run and reused by every exercise. The
 *  browser runtime itself is built lazily inside `run` — the dock also renders
 *  on the server, where there is no `window` to resolve the app origin from. */
export function codeRuntimeFor(language: CodeLanguage): CodeRuntime {
	let runtime = runtimes.get(language);
	if (!runtime) {
		let browserRuntime: CodeRuntime | undefined;
		runtime = {
			language,
			run: (request: CodeRunRequest): Promise<CodeRunResult> => {
				browserRuntime ??= createBrowserPythonRuntime(pyodideIndexUrl());
				return browserRuntime.run(request);
			},
		};
		runtimes.set(language, runtime);
	}
	return runtime;
}
