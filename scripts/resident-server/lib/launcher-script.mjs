/**
 * The AppleScript inside the MasteryHarness Desktop launcher. It runs the
 * launcher's own copy of open-desktop.mjs and shows a failure as an alert.
 */

/** Where the launcher keeps its copy of scripts/resident-server, inside Contents/Resources. */
export const LAUNCHER_SCRIPTS_DIR = "resident-server";

/** @param {string} text */
export function appleScriptString(text) {
	return `"${text.replace(/[\\"]/g, "\\$&")}"`;
}

/** @param {string} node the absolute path of the `node` to run */
export function launcherAppleScript(node) {
	return `-- MasteryHarness Desktop: opens the desktop app in place of the resident server.
-- Built by scripts/resident-server/desktop-launcher.mjs; changes here are overwritten.
on run
	set switchScript to POSIX path of (path to me) & ${appleScriptString(`Contents/Resources/${LAUNCHER_SCRIPTS_DIR}/open-desktop.mjs`)}
	try
		do shell script (quoted form of ${appleScriptString(node)}) & " " & (quoted form of switchScript)
	on error problem
		display alert "MasteryHarness Desktop" message problem as critical
	end try
end run
`;
}
