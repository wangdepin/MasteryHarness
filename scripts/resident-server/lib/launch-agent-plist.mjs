/**
 * The LaunchAgent that keeps the resident server running: started at login,
 * restarted when it exits. A start the script refuses (the desktop app is
 * open, the settings are unsound) is retried every ThrottleInterval seconds,
 * which is how the server comes up by itself once the desktop app quits.
 */
const RETRY_SECONDS = 30;

const escapeXml = (text) => text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
const string = (text) => `<string>${escapeXml(text)}</string>`;

export function launchAgentPlist({ label, node, startScript, workingDirectory, logFile }) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	${string(label)}
	<key>ProgramArguments</key>
	<array>
		${string(node)}
		${string(startScript)}
	</array>
	<key>WorkingDirectory</key>
	${string(workingDirectory)}
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>${RETRY_SECONDS}</integer>
	<key>StandardOutPath</key>
	${string(logFile)}
	<key>StandardErrorPath</key>
	${string(logFile)}
</dict>
</plist>
`;
}
