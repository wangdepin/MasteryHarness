/**
 * Installs the server just built in .next/standalone as a new release and
 * points `current` at it. The repo's build folder is rewritten by every
 * build and deleted by desktop packaging, so the resident server never runs
 * from there.
 *
 *   npm run build && node scripts/build-server.mjs && node scripts/smoke-server.mjs
 *   node scripts/resident-server/deploy.mjs
 *
 * Restart the service afterwards; this script does not touch a running one.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { forbiddenPayload, isBuiltServer } from "./lib/payload.mjs";
import { CURRENT_LINK, LABEL, RELEASES_DIR, SCRIPTS_IN_RELEASE } from "./lib/paths.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

function fail(message) {
	console.error(`[deploy] ${message}`);
	process.exit(1);
}

function git(...args) {
	return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** "<version>-<commit>", with "-dirty" when the build may not match the commit. */
function releaseName() {
	const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	const dirty = git("status", "--porcelain", "--untracked-files=no") ? "-dirty" : "";
	return `${version}-${git("rev-parse", "--short", "HEAD")}${dirty}`;
}

function copyRelease(target) {
	fs.rmSync(target, { recursive: true, force: true });
	fs.cpSync(STANDALONE, target, { recursive: true, verbatimSymlinks: true });
	fs.cpSync(import.meta.dirname, path.join(target, SCRIPTS_IN_RELEASE), { recursive: true });
}

/** A rename replaces the link in one step, so `current` always names a whole release. */
function pointCurrentAt(target) {
	const staged = `${CURRENT_LINK}.next`;
	fs.rmSync(staged, { force: true });
	fs.symlinkSync(target, staged);
	fs.renameSync(staged, CURRENT_LINK);
}

if (!isBuiltServer(STANDALONE)) fail("no finished build in .next/standalone. Run: npm run build && node scripts/build-server.mjs");
const forbidden = forbiddenPayload(STANDALONE);
if (forbidden.length > 0) fail(`REFUSING: the build contains ${forbidden.join(", ")}. Lesson data and sign-in files must never be copied into a release.`);

const name = releaseName();
const target = path.join(RELEASES_DIR, name);
fs.mkdirSync(RELEASES_DIR, { recursive: true, mode: 0o700 });
copyRelease(target);
pointCurrentAt(target);

const older = fs.readdirSync(RELEASES_DIR).filter((entry) => entry !== name);
console.log(`[deploy] release ${name} is current: ${target}`);
if (older.length > 0) console.log(`[deploy] older releases kept in ${RELEASES_DIR}: ${older.join(", ")}`);
console.log(`[deploy] restart the service: launchctl kickstart -k gui/$(id -u)/${LABEL}`);
