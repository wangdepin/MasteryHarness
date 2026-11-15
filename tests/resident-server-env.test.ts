import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvFile } from "../scripts/resident-server/lib/env-file.mjs";
import { launchAgentPlist } from "../scripts/resident-server/lib/launch-agent-plist.mjs";
import { forbiddenPayload } from "../scripts/resident-server/lib/payload.mjs";
import { serverEnvProblems } from "../scripts/resident-server/lib/server-env.mjs";

const SOUND = {
	LH_ACCESS_TOKEN: "ab".repeat(32),
	HOSTNAME: "127.0.0.1",
	PORT: "4747",
	LH_DATA_DIR: "/profile/data",
	LH_AUTH_FILE: "/profile/auth.json",
	PATH: "/opt/homebrew/bin:/usr/bin",
};
const folders = new Set(["/profile/data", "/profile"]);
const problems = (over: Record<string, string | undefined> = {}) => serverEnvProblems({ ...SOUND, ...over }, (target: string) => folders.has(target));

test("sound settings have no problems", () => {
	assert.deepEqual(problems(), []);
	assert.deepEqual(problems({ LH_ALLOWED_HOSTS: "mac.tail1234.ts.net", CHROME_PATH: "/chrome" }), []);
});

test("the server never starts without a well-formed token", () => {
	for (const token of [undefined, "", "short", "g".repeat(64), "ab".repeat(31)]) {
		assert.match(problems({ LH_ACCESS_TOKEN: token }).join("\n"), /LH_ACCESS_TOKEN/, String(token));
	}
});

test("the server only ever listens on this Mac", () => {
	for (const host of [undefined, "0.0.0.0", "localhost", "::", "192.168.1.5"]) {
		assert.match(problems({ HOSTNAME: host }).join("\n"), /HOSTNAME must be 127\.0\.0\.1/, String(host));
	}
});

test("port, data folder, auth file and PATH are all required", () => {
	for (const port of [undefined, "", "80", "70000", "47.5", "abc"]) assert.match(problems({ PORT: port }).join("\n"), /PORT/, String(port));
	assert.match(problems({ LH_DATA_DIR: "/nowhere" }).join("\n"), /LH_DATA_DIR/);
	assert.match(problems({ LH_DATA_DIR: undefined }).join("\n"), /LH_DATA_DIR/);
	assert.match(problems({ LH_AUTH_FILE: "/nowhere/auth.json" }).join("\n"), /LH_AUTH_FILE/);
	assert.match(problems({ PATH: undefined }).join("\n"), /PATH must be set/);
});

test("desktop-shell variables are refused: they would switch the gate off", () => {
	assert.match(problems({ LH_DESKTOP_SERVER: "1" }).join("\n"), /LH_DESKTOP_SERVER/);
	assert.match(problems({ LH_DESKTOP_API_SECRET: "x".repeat(64) }).join("\n"), /LH_DESKTOP_API_SECRET/);
});

test("every problem is reported at once", () => {
	assert.equal(serverEnvProblems({}, () => false).length, 6);
});

test("server.env is KEY=VALUE data with comments and optional quotes", () => {
	const env = parseEnvFile(['# a comment', '', 'PORT=4747', ' HOSTNAME = 127.0.0.1 '.trim().replace(" = ", "="), 'LH_DATA_DIR="/Users/me/Library/Application Support/MasteryHarness/data"', "PATH='/a:/b'", "EMPTY="].join("\n"));
	assert.deepEqual(env, { PORT: "4747", HOSTNAME: "127.0.0.1", LH_DATA_DIR: "/Users/me/Library/Application Support/MasteryHarness/data", PATH: "/a:/b", EMPTY: "" });
	assert.throws(() => parseEnvFile("export PORT=4747"), /cannot read the line/);
	assert.throws(() => parseEnvFile("not a setting"), /cannot read the line/);
});

test("the login item starts at login, restarts on exit and retries every 30 seconds", () => {
	const plist = launchAgentPlist({ label: "com.masteryharness.server", node: "/opt/homebrew/bin/node", startScript: "/install/current/resident-server/start.mjs", workingDirectory: "/install/current", logFile: "/logs/A & B/server.log" });
	assert.match(plist, /<key>Label<\/key>\s*<string>com\.masteryharness\.server<\/string>/);
	assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>\s*<string>\/install\/current\/resident-server\/start\.mjs<\/string>/);
	assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
	assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
	assert.match(plist, /<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/);
	assert.match(plist, /A &amp; B/, "paths are escaped");
});

test("lesson data and sign-in files are never copied into a release", () => {
	const listing = (names: string[]) => () => names;
	assert.deepEqual(forbiddenPayload("/build", listing(["server.js", ".next", "node_modules", "public"])), []);
	assert.deepEqual(
		forbiddenPayload("/build", listing(["server.js", "data", "auth.json", "chatgpt-credentials.json", "xai-credentials.json.bak", "oauth-credentials.json", ".env.local"])),
		["data", "auth.json", "chatgpt-credentials.json", "xai-credentials.json.bak", "oauth-credentials.json", ".env.local"],
	);
});
