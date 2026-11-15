/**
 * Hands the shared data from the resident server to the desktop app.
 *
 * The two must never run at once, and a running server does not notice the
 * desktop app opening. So the server is stopped first and the app opened
 * only once nothing answers on the server's port. The service is then
 * loaded again: its start script finds the desktop app holding the data and
 * refuses, and launchd retries every 30 seconds until the app has quit
 * (launch-agent-plist.mjs). Nothing has to stay behind to wait for that.
 */

/**
 * @typedef {object} SwitchSteps
 * @property {() => void} stopServer           unload the service; nothing when it is not loaded
 * @property {() => Promise<boolean>} serverListening
 * @property {() => void} openDesktop          throws when the app cannot be opened
 * @property {() => boolean} desktopRunning    the app holds the shared data
 * @property {() => boolean} serviceInstalled
 * @property {() => void} startServer          load the service
 * @property {(ms: number) => Promise<void>} sleep
 */

/**
 * @typedef {object} SwitchTiming
 * @property {string} startCommand    what a person runs to start the server by hand
 * @property {number} [pollMs]
 * @property {number} [stopTimeoutMs]
 * @property {number} [startTimeoutMs]
 */

/**
 * @param {() => boolean | Promise<boolean>} condition
 * @param {number} timeoutMs
 * @param {number} pollMs
 * @param {(ms: number) => Promise<void>} sleep
 */
async function waitUntil(condition, timeoutMs, pollMs, sleep) {
	for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
		if (await condition()) return true;
		await sleep(pollMs);
	}
	return false;
}

/**
 * @param {SwitchSteps} steps
 * @param {SwitchTiming} timing
 * @returns {Promise<"handed-over" | "no-service">}
 */
export async function switchToDesktop(steps, { startCommand, pollMs = 250, stopTimeoutMs = 20_000, startTimeoutMs = 60_000 }) {
	steps.stopServer();
	const stopped = await waitUntil(async () => !(await steps.serverListening()), stopTimeoutMs, pollMs, steps.sleep);
	if (!stopped) throw new Error("The phone server is still running, so the desktop app was not opened. Try again in a moment.");

	try {
		steps.openDesktop();
	} catch (error) {
		if (steps.serviceInstalled()) steps.startServer();
		throw error;
	}
	const opened = await waitUntil(steps.desktopRunning, startTimeoutMs, pollMs, steps.sleep);
	if (!opened) {
		throw new Error(`The desktop app did not open within a minute. The phone server stays stopped so the two never run together. Start it again with:\n${startCommand}`);
	}

	if (!steps.serviceInstalled()) return "no-service";
	steps.startServer();
	return "handed-over";
}
