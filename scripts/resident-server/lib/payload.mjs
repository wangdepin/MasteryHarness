/**
 * What may never be copied into a release: lesson data and sign-in files.
 * scripts/build-server.mjs refuses the same names when it finishes a build;
 * checking again here keeps a hand-edited or stale build out of a release.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const FORBIDDEN = ["data", "auth.json", "oauth-credentials.json", ".env", ".env.local"];
const CREDENTIALS = /-credentials\.json/;

/** @type {(folder: string) => string[]} */
const listFolder = (folder) => fs.readdirSync(folder);

/**
 * Names at the top of `standalone` that must not ship.
 * @param {string} standalone
 * @param {(folder: string) => string[]} [readdir]
 */
export function forbiddenPayload(standalone, readdir = listFolder) {
	return readdir(standalone).filter((name) => FORBIDDEN.includes(name) || CREDENTIALS.test(name));
}

export function isBuiltServer(standalone) {
	return fs.existsSync(path.join(standalone, "server.js")) && fs.existsSync(path.join(standalone, ".next", "static"));
}
