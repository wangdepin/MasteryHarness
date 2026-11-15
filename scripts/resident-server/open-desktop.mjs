/**
 * Opens the desktop app in place of the resident server. This is what the
 * MasteryHarness Desktop launcher runs (desktop-launcher.mjs); the steps
 * and why they are safe are in lib/switch-to-desktop.mjs.
 *
 *   node scripts/resident-server/open-desktop.mjs
 *
 * A failure is printed on stderr alone, which the launcher shows as is.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import { desktopAppRunning } from "./lib/desktop-lock.mjs";
import { readEnvFile } from "./lib/env-file.mjs";
import { DESKTOP_APP, DESKTOP_PROFILE_DIR, ENV_FILE, LAUNCH_AGENT_FILE } from "./lib/paths.mjs";
import { START_COMMAND, startService, stopService } from "./lib/service.mjs";
import { switchToDesktop } from "./lib/switch-to-desktop.mjs";

/** The port in resident-server.env.example, for a settings file this account cannot read. */
const DEFAULT_PORT = 4747;

function serverPort() {
	try {
		return Number(readEnvFile(ENV_FILE).PORT) || DEFAULT_PORT;
	} catch {
		return DEFAULT_PORT;
	}
}

/** @param {number} port */
function listening(port) {
	return new Promise((resolve) => {
		const socket = net.connect({ host: "127.0.0.1", port, timeout: 1000 });
		const settle = (answer) => {
			socket.destroy();
			resolve(answer);
		};
		socket.once("connect", () => settle(true));
		socket.once("error", () => settle(false));
		socket.once("timeout", () => settle(false));
	});
}

function openDesktopApp() {
	if (!fs.existsSync(DESKTOP_APP)) throw new Error(`The desktop app is not installed at ${DESKTOP_APP}.`);
	execFileSync("open", [DESKTOP_APP], { stdio: "ignore" });
}

const port = serverPort();
try {
	await switchToDesktop(
		{
			stopServer: stopService,
			serverListening: () => listening(port),
			openDesktop: openDesktopApp,
			desktopRunning: () => desktopAppRunning(DESKTOP_PROFILE_DIR),
			serviceInstalled: () => fs.existsSync(LAUNCH_AGENT_FILE),
			startServer: startService,
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		},
		{ startCommand: START_COMMAND },
	);
} catch (error) {
	process.stderr.write(error.message);
	process.exit(1);
}
