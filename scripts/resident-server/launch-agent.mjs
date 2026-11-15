/**
 * Installs or removes the login item that keeps the resident server running.
 *
 *   node scripts/resident-server/launch-agent.mjs print       show the plist, change nothing
 *   node scripts/resident-server/launch-agent.mjs install     write it and start the service
 *   node scripts/resident-server/launch-agent.mjs uninstall   stop the service and remove it
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { launchAgentPlist } from "./lib/launch-agent-plist.mjs";
import { nodeOnPath } from "./lib/node-path.mjs";
import { CURRENT_LINK, LABEL, LAUNCH_AGENT_FILE, LOG_DIR, SCRIPTS_IN_RELEASE } from "./lib/paths.mjs";
import { startService, stopService } from "./lib/service.mjs";

function plist() {
	return launchAgentPlist({
		label: LABEL,
		node: nodeOnPath(),
		startScript: path.join(CURRENT_LINK, SCRIPTS_IN_RELEASE, "start.mjs"),
		workingDirectory: CURRENT_LINK,
		logFile: path.join(LOG_DIR, "server.log"),
	});
}

function install() {
	if (!fs.existsSync(CURRENT_LINK)) throw new Error("no release is deployed yet. Run deploy.mjs first.");
	fs.mkdirSync(LOG_DIR, { recursive: true });
	fs.mkdirSync(path.dirname(LAUNCH_AGENT_FILE), { recursive: true });
	stopService();
	fs.writeFileSync(LAUNCH_AGENT_FILE, plist());
	startService();
	console.log(`[launch-agent] ${LABEL} installed and started. Log: ${path.join(LOG_DIR, "server.log")}`);
}

function uninstall() {
	stopService();
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
