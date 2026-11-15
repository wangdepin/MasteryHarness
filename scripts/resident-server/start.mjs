/**
 * Starts the resident server: the one long-lived MasteryHarness server on
 * this Mac that the Mac's browser and the iPhone both use.
 *
 * launchd runs this at login and again whenever it exits. It refuses to
 * start, rather than start unsafely, when the settings are unsound or the
 * desktop app is already using the same data.
 *
 *   node start.mjs [path/to/server.env]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { desktopAppRunning, sharesDesktopProfile } from "./lib/desktop-lock.mjs";
import { readEnvFile } from "./lib/env-file.mjs";
import { DESKTOP_PROFILE_DIR, ENV_FILE } from "./lib/paths.mjs";
import { serverEnvProblems } from "./lib/server-env.mjs";

/** sysexits.h: EX_CONFIG and EX_TEMPFAIL. */
const EXIT_BAD_SETTINGS = 78;
const EXIT_DESKTOP_APP_OPEN = 75;

const say = (message) => console.error(`[resident-server] ${new Date().toISOString()} ${message}`);

function refuse(code, lines) {
	for (const line of lines) say(line);
	process.exit(code);
}

function loadSettings(file) {
	try {
		return readEnvFile(file);
	} catch (error) {
		refuse(EXIT_BAD_SETTINGS, [`cannot read settings: ${error.message}`]);
	}
}

const settings = loadSettings(process.argv[2] ?? ENV_FILE);
const problems = serverEnvProblems(settings);
if (problems.length > 0) refuse(EXIT_BAD_SETTINGS, ["not starting:", ...problems.map((problem) => `  - ${problem}`)]);
if (sharesDesktopProfile(settings, DESKTOP_PROFILE_DIR) && desktopAppRunning(DESKTOP_PROFILE_DIR)) {
	refuse(EXIT_DESKTOP_APP_OPEN, ["not starting: the MasteryHarness desktop app is open and uses the same data. Quit it and the server starts by itself."]);
}

for (const name of ["LH_DESKTOP_SERVER", "LH_DESKTOP_API_SECRET"]) delete process.env[name];
Object.assign(process.env, settings, { NODE_ENV: "production" });

const release = path.resolve(import.meta.dirname, "..");
if (!fs.existsSync(path.join(release, "server.js"))) {
	refuse(EXIT_BAD_SETTINGS, ["not starting: this script runs from a deployed release, not from the repo. Run deploy.mjs first."]);
}
say(`starting ${path.basename(release)} on http://${settings.HOSTNAME}:${settings.PORT}`);
await import(pathToFileURL(path.join(release, "server.js")).href);
