/**
 * Is the desktop app using this profile right now?
 *
 * The app and the resident server share one data folder, and the folder has
 * a single writer. Electron marks a profile in use with a SingletonLock link
 * whose target is "<host>-<pid>". A crash leaves the link behind and the pid
 * may since belong to something else, so the process is checked by name too.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const LOCK_NAME = "SingletonLock";
const LOCK_TARGET = /-(\d+)$/;
const APP_NAME = "MasteryHarness";

/** @type {(file: string) => string} */
const readLink = (file) => fs.readlinkSync(file, "utf8");

/**
 * The pid the lock names, or null when there is no readable lock.
 * @param {string} profileDir
 * @param {(file: string) => string} [readlink]
 */
export function lockedPid(profileDir, readlink = readLink) {
	let target;
	try {
		target = readlink(path.join(profileDir, LOCK_NAME));
	} catch {
		return null;
	}
	const match = LOCK_TARGET.exec(target);
	return match ? Number(match[1]) : null;
}

function commandOf(pid) {
	try {
		return execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

/**
 * True only for a live process that is the desktop app itself.
 * @param {string} profileDir
 * @param {{ readlink?: (file: string) => string, command?: (pid: number) => string }} [probes]
 */
export function desktopAppRunning(profileDir, { readlink = readLink, command = commandOf } = {}) {
	const pid = lockedPid(profileDir, readlink);
	if (pid === null) return false;
	return command(pid).includes(APP_NAME);
}

function isInside(folder, target) {
	const relative = path.relative(path.resolve(folder), path.resolve(target));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Does the server share the desktop app's files? Only then can the two collide.
 * @param {Record<string, string | undefined>} settings
 * @param {string} profileDir
 */
export function sharesDesktopProfile(settings, profileDir) {
	return [settings.LH_DATA_DIR, settings.LH_AUTH_FILE].some((target) => Boolean(target) && isInside(profileDir, target));
}
