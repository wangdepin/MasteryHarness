/**
 * Installs or removes the login item that keeps the resident server running.
 *
 *   node scripts/resident-server/launch-agent.mjs print       show the plist, change nothing
 *   node scripts/resident-server/launch-agent.mjs install     write it and start the service
 *   node scripts/resident-server/launch-agent.mjs uninstall   stop the service and remove it
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { launchAgentPlist } from "./lib/launch-agent-plist.mjs";
import { CURRENT_LINK, LABEL, LAUNCH_AGENT_FILE, LOG_DIR, SCRIPTS_IN_RELEASE } from "./lib/paths.mjs";

const DOMAIN = `gui/${process.getuid()}`;

/** The `node` found on PATH, unresolved: a package manager's stable link survives upgrades, its versioned folder does not. */
function nodeOnPath() {
	for (const folder of (process.env.PATH ?? "").split(path.delimiter)) {
		const candidate = path.join(folder, "node");
		if (folder && fs.existsSync(candidate)) return candidate;
	}
	return process.execPath;
}

function plist() {
	return launchAgentPlist({
		label: LABEL,
		node: nodeOnPath(),
		startScript: path.join(CURRENT_LINK, SCRIPTS_IN_RELEASE, "start.mjs"),
		workingDirectory: CURRENT_LINK,
		logFile: path.join(LOG_DIR, "server.log"),
	});
}

function launchctl(...args) {
	execFileSync("launchctl", args, { stdio: "inherit" });
}

function stopIfLoaded() {
	try {
		execFileSync("launchctl", ["bootout", `${DOMAIN}/${LABEL}`], { stdio: "ignore" });
	} catch {
		// Not loaded: nothing to stop.
	}
}

function install() {
	if (!fs.existsSync(CURRENT_LINK)) throw new Error("no release is deployed yet. Run deploy.mjs first.");
	fs.mkdirSync(LOG_DIR, { recursive: true });
	fs.mkdirSync(path.dirname(LAUNCH_AGENT_FILE), { recursive: true });
	stopIfLoaded();
	fs.writeFileSync(LAUNCH_AGENT_FILE, plist());
	launchctl("bootstrap", DOMAIN, LAUNCH_AGENT_FILE);
	console.log(`[launch-agent] ${LABEL} installed and started. Log: ${path.join(LOG_DIR, "server.log")}`);
}

function uninstall() {
	stopIfLoaded();
	fs.rmSync(LAUNCH_AGENT_FILE, { force: true });
	console.log(`[launch-agent] ${LABEL} stopped and removed.`);
}

const commands = { print: () => process.stdout.write(plist()), install, uninstall };
const command = commands[process.argv[2]];
if (!command) {
	console.error("usage: launch-agent.mjs print | install | uninstall");
	process.exit(2);
}
try {
	command();
} catch (error) {
	console.error(`[launch-agent] ${error.message}`);
	process.exit(1);
}
