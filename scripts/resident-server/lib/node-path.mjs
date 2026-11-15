/**
 * The `node` that the LaunchAgent and the desktop launcher run, found once
 * at install time: launchd and Finder give their programs no useful PATH.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** The `node` found on PATH, unresolved: a package manager's stable link survives upgrades, its versioned folder does not. */
export function nodeOnPath() {
	for (const folder of (process.env.PATH ?? "").split(path.delimiter)) {
		const candidate = path.join(folder, "node");
		if (folder && fs.existsSync(candidate)) return candidate;
	}
	return process.execPath;
}
