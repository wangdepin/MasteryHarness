import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopAppRunning, lockedPid, sharesDesktopProfile } from "../scripts/resident-server/lib/desktop-lock.mjs";

const PROFILE = "/profile";
const link = (target: string) => () => target;
const missing = () => { throw new Error("ENOENT"); };
const APP = "/Applications/MasteryHarness.app/Contents/MacOS/MasteryHarness";

test("the lock names the pid after the last dash of its target", () => {
	assert.equal(lockedPid(PROFILE, link("Depins-MacBook-Pro.local-38214")), 38214);
	assert.equal(lockedPid(PROFILE, link("host-with-9-dashes-7")), 7);
});

test("no lock, or one that names no pid, is no pid", () => {
	assert.equal(lockedPid(PROFILE, missing), null);
	for (const target of ["", "hostname", "host-", "host-12x"]) assert.equal(lockedPid(PROFILE, link(target)), null, target);
});

test("the desktop app is running when the locked pid is the app itself", () => {
	assert.equal(desktopAppRunning(PROFILE, { readlink: link("host-38214"), command: () => APP }), true);
});

test("a lock left by a crash does not count: the pid is gone or belongs to something else", () => {
	assert.equal(desktopAppRunning(PROFILE, { readlink: link("host-38214"), command: () => "" }), false, "no such process");
	assert.equal(desktopAppRunning(PROFILE, { readlink: link("host-38214"), command: () => "/usr/sbin/cupsd" }), false, "pid reused");
	assert.equal(desktopAppRunning(PROFILE, { readlink: missing, command: () => APP }), false, "no lock at all");
});

test("the two can only collide when the server uses the desktop app's own files", () => {
	const profile = "/Users/me/Library/Application Support/MasteryHarness";
	assert(sharesDesktopProfile({ LH_DATA_DIR: `${profile}/data`, LH_AUTH_FILE: `${profile}/auth.json` }, profile));
	assert(sharesDesktopProfile({ LH_DATA_DIR: "/tmp/data", LH_AUTH_FILE: `${profile}/auth.json` }, profile), "shared sign-ins alone collide");
	assert(!sharesDesktopProfile({ LH_DATA_DIR: "/tmp/data", LH_AUTH_FILE: "/tmp/auth.json" }, profile));
	assert(!sharesDesktopProfile({ LH_DATA_DIR: `${profile}-server/data`, LH_AUTH_FILE: `${profile}-server/auth.json` }, profile), "a sibling folder is not inside");
});
