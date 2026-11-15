/**
 * Where the resident server lives on this Mac. One place, so the start
 * script, the deploy script and the LaunchAgent agree.
 */
import * as os from "node:os";
import * as path from "node:path";

const APPLICATION_SUPPORT = path.join(os.homedir(), "Library", "Application Support");

export const LABEL = "com.masteryharness.server";
/** Releases, the `current` link and server.env. */
export const INSTALL_DIR = path.join(APPLICATION_SUPPORT, "MasteryHarness-server");
export const RELEASES_DIR = path.join(INSTALL_DIR, "releases");
export const CURRENT_LINK = path.join(INSTALL_DIR, "current");
export const ENV_FILE = path.join(INSTALL_DIR, "server.env");
export const LOG_DIR = path.join(os.homedir(), "Library", "Logs", "MasteryHarness-server");
/** The desktop app's profile: its data, its sign-ins and its single-instance lock. */
export const DESKTOP_PROFILE_DIR = path.join(APPLICATION_SUPPORT, "MasteryHarness");
export const LAUNCH_AGENT_FILE = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
/** The scripts ride along inside each release, so the service never depends on the repo checkout. */
export const SCRIPTS_IN_RELEASE = "resident-server";
