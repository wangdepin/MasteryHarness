/**
 * Loading and unloading the resident server's LaunchAgent. Loading starts
 * the server (RunAtLoad); unloading stops it and keeps launchd from
 * starting it again until the next load or the next login.
 */
import { execFileSync } from "node:child_process";
import { LABEL, LAUNCH_AGENT_FILE } from "./paths.mjs";

const DOMAIN = `gui/${process.getuid()}`;

/** What a person types to start the server again by hand. */
export const START_COMMAND = `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${LABEL}.plist`;

/** Stops the server; nothing when the service is not loaded. */
export function stopService() {
	try {
		execFileSync("launchctl", ["bootout", `${DOMAIN}/${LABEL}`], { stdio: "ignore" });
	} catch {
		// Not loaded: nothing to stop.
	}
}

export function startService() {
	execFileSync("launchctl", ["bootstrap", DOMAIN, LAUNCH_AGENT_FILE], { stdio: ["ignore", "ignore", "pipe"] });
}
