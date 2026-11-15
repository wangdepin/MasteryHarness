/**
 * Installs the MasteryHarness Desktop launcher: an app beside the desktop
 * app in /Applications that opens it in place of the resident server
 * (open-desktop.mjs). While the resident server is installed, open the
 * desktop app only through the launcher.
 *
 *   node scripts/resident-server/desktop-launcher.mjs print       show the AppleScript, change nothing
 *   node scripts/resident-server/desktop-launcher.mjs install     build it into /Applications
 *   node scripts/resident-server/desktop-launcher.mjs uninstall   remove it
 *
 * The launcher carries its own copy of these scripts: install it again
 * after they change.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LAUNCHER_SCRIPTS_DIR, launcherAppleScript } from "./lib/launcher-script.mjs";
import { nodeOnPath } from "./lib/node-path.mjs";
import { DESKTOP_APP, DESKTOP_LAUNCHER_APP } from "./lib/paths.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
/** The desktop app's own full-resolution icon. */
const ICON = path.join(ROOT, "build", "icon.icns");
const BUNDLE_ID = "com.masteryharness.desktop-launcher";

function run(command, ...args) {
	execFileSync(command, args, { stdio: ["ignore", "ignore", "inherit"] });
}

function compile(app, staging) {
	const source = path.join(staging, "launcher.applescript");
	fs.writeFileSync(source, launcherAppleScript(nodeOnPath()));
	run("osacompile", "-o", app, source);
}

/** The applet's own icon is Script Editor's; the desktop app's replaces it. */
function useDesktopIcon(app) {
	const info = path.join(app, "Contents", "Info.plist");
	fs.copyFileSync(ICON, path.join(app, "Contents", "Resources", "applet.icns"));
	fs.rmSync(path.join(app, "Contents", "Resources", "Assets.car"), { force: true });
	try {
		execFileSync("plutil", ["-remove", "CFBundleIconName", info], { stdio: "ignore" });
	} catch {
		// No asset-catalog icon named: applet.icns is already the icon.
	}
}

function build(app, staging) {
	compile(app, staging);
	fs.cpSync(import.meta.dirname, path.join(app, "Contents", "Resources", LAUNCHER_SCRIPTS_DIR), { recursive: true });
	useDesktopIcon(app);
	run("plutil", "-replace", "CFBundleIdentifier", "-string", BUNDLE_ID, path.join(app, "Contents", "Info.plist"));
	// The changes above break the applet's seal; sign it again, ad hoc, as osacompile did.
	run("codesign", "--force", "--deep", "--sign", "-", app);
}

function install() {
	if (!fs.existsSync(DESKTOP_APP)) throw new Error(`no desktop app at ${DESKTOP_APP}. Copy it there first.`);
	const staging = fs.mkdtempSync(path.join(os.tmpdir(), "masteryharness-launcher-"));
	try {
		const app = path.join(staging, path.basename(DESKTOP_LAUNCHER_APP));
		build(app, staging);
		fs.rmSync(DESKTOP_LAUNCHER_APP, { recursive: true, force: true });
		run("ditto", app, DESKTOP_LAUNCHER_APP);
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
	console.log(`[desktop-launcher] installed ${DESKTOP_LAUNCHER_APP}. Open the desktop app only through it.`);
}

function uninstall() {
	fs.rmSync(DESKTOP_LAUNCHER_APP, { recursive: true, force: true });
	console.log(`[desktop-launcher] removed ${DESKTOP_LAUNCHER_APP}.`);
}

const commands = { print: () => process.stdout.write(launcherAppleScript(nodeOnPath())), install, uninstall };
const command = commands[process.argv[2]];
if (!command) {
	console.error("usage: desktop-launcher.mjs print | install | uninstall");
	process.exit(2);
}
try {
	command();
} catch (error) {
	console.error(`[desktop-launcher] ${error.message}`);
	process.exit(1);
}
