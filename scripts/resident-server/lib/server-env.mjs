/**
 * What the resident server's environment must look like before it may start.
 * The server is reachable from other devices, so a missing or malformed
 * setting stops it rather than leaving it open.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

const isDirectory = (target) => {
	try {
		return fs.statSync(target).isDirectory();
	} catch {
		return false;
	}
};

function portProblem(port) {
	const value = Number(port);
	return Number.isInteger(value) && value >= 1024 && value <= 65535 ? null : "PORT must be a whole number from 1024 to 65535";
}

/** Every problem found, as sentences a person can act on; empty when the environment is sound. */
export function serverEnvProblems(env, directoryExists = isDirectory) {
	const problems = [];
	if (!TOKEN_PATTERN.test(env.LH_ACCESS_TOKEN ?? "")) problems.push("LH_ACCESS_TOKEN must be 64 hexadecimal characters (openssl rand -hex 32)");
	if (env.HOSTNAME !== "127.0.0.1") problems.push("HOSTNAME must be 127.0.0.1, so only this Mac and Tailscale Serve can connect");
	const port = portProblem(env.PORT);
	if (port) problems.push(port);
	if (!env.LH_DATA_DIR || !directoryExists(env.LH_DATA_DIR)) problems.push("LH_DATA_DIR must be an existing folder");
	if (!env.LH_AUTH_FILE || !directoryExists(path.dirname(env.LH_AUTH_FILE))) problems.push("LH_AUTH_FILE must sit in an existing folder");
	if (!env.PATH) problems.push("PATH must be set: launchd's own PATH cannot find node or the claude CLI");
	for (const name of ["LH_DESKTOP_SERVER", "LH_DESKTOP_API_SECRET"]) {
		if (env[name]) problems.push(`${name} belongs to the desktop app and switches the access gate off: remove it`);
	}
	return problems;
}
