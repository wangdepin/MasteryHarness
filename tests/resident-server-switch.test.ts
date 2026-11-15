import { test } from "node:test";
import assert from "node:assert/strict";
import { appleScriptString, launcherAppleScript } from "../scripts/resident-server/lib/launcher-script.mjs";
import { switchToDesktop, type SwitchSteps } from "../scripts/resident-server/lib/switch-to-desktop.mjs";

const START_COMMAND = "launchctl bootstrap gui/501 agent.plist";

interface FakeMac {
	steps: SwitchSteps;
	calls: string[];
}

/** A Mac whose server answers `listeningPolls` more checks after the stop, and whose desktop app takes `desktopPolls` checks to hold the data. */
function fakeMac({ listeningPolls = 0, desktopPolls = 0, installed = true, openFails = false } = {}): FakeMac {
	const calls: string[] = [];
	let listening = listeningPolls;
	let opened = false;
	let desktop = desktopPolls;
	const steps: SwitchSteps = {
		stopServer: () => void calls.push("stop"),
		serverListening: async () => listening-- > 0,
		openDesktop: () => {
			calls.push("open");
			if (openFails) throw new Error("Unable to find application named 'MasteryHarness'");
			opened = true;
		},
		desktopRunning: () => opened && desktop-- <= 0,
		serviceInstalled: () => installed,
		startServer: () => void calls.push("start"),
		sleep: async () => {},
	};
	return { steps, calls };
}

const timing = { startCommand: START_COMMAND, pollMs: 100, stopTimeoutMs: 1000, startTimeoutMs: 1000 };

test("the server stops, the desktop app opens, and the service is loaded again once the app holds the data", async () => {
	const mac = fakeMac({ listeningPolls: 3, desktopPolls: 4 });
	assert.equal(await switchToDesktop(mac.steps, timing), "handed-over");
	assert.deepEqual(mac.calls, ["stop", "open", "start"]);
});

test("the desktop app is not opened while the server still answers", async () => {
	const mac = fakeMac({ listeningPolls: 100 });
	await assert.rejects(switchToDesktop(mac.steps, timing), /still running.*not opened/);
	assert.deepEqual(mac.calls, ["stop"]);
});

test("a desktop app that never takes the data leaves the server stopped, and says how to start it", async () => {
	const mac = fakeMac({ desktopPolls: 100 });
	await assert.rejects(switchToDesktop(mac.steps, timing), (error: Error) => {
		assert.match(error.message, /did not open/);
		assert(error.message.includes(START_COMMAND));
		return true;
	});
	assert.deepEqual(mac.calls, ["stop", "open"]);
});

test("a desktop app that cannot be opened at all gives the server back at once", async () => {
	const mac = fakeMac({ openFails: true });
	await assert.rejects(switchToDesktop(mac.steps, timing), /Unable to find application/);
	assert.deepEqual(mac.calls, ["stop", "open", "start"]);
});

test("without the service installed there is nothing to load again", async () => {
	const mac = fakeMac({ installed: false });
	assert.equal(await switchToDesktop(mac.steps, timing), "no-service");
	assert.deepEqual(mac.calls, ["stop", "open"]);
});

test("a desktop app that is already open is brought forward and the service loaded straight away", async () => {
	const mac = fakeMac();
	mac.steps.desktopRunning = () => true;
	assert.equal(await switchToDesktop(mac.steps, timing), "handed-over");
	assert.deepEqual(mac.calls, ["stop", "open", "start"]);
});

test("the launcher's AppleScript quotes the node path and runs its own copy of open-desktop.mjs", () => {
	assert.equal(appleScriptString('a "b" \\c'), '"a \\"b\\" \\\\c"');
	const script = launcherAppleScript("/opt/homebrew/bin/node");
	assert.match(script, /quoted form of "\/opt\/homebrew\/bin\/node"/);
	assert.match(script, /"Contents\/Resources\/resident-server\/open-desktop\.mjs"/);
	assert.match(script, /display alert/);
});
