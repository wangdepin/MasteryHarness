// electron-builder afterPack hook — mac only.
//
// WHY (owner ruling 2026-10-13): mac.icon is the Icon Composer document
// (build/icon.icon); actool compiles it into Assets.car (the macOS 26
// Liquid Glass render) PLUS a backwards-compat icns — but actool's
// fallback icns caps at 256px (known actool behavior), which looks soft
// at Finder/Launchpad sizes on pre-Tahoe macOS. This hook swaps in the
// hand-packed full-res build/icon.icns (all 10 entries, 16→1024, packed
// via iconutil from the design's PNG exports) AFTER packaging and BEFORE
// signing, so:
//
//   macOS 26+  → Assets.car (CFBundleIconName) — true layered glass icon;
//   older mac  → icon.icns (CFBundleIconFile) — today's full-res flatten.
//
// Windows/Linux builds return immediately (their icons are static files:
// build/icon.ico / build/icon.png).
//
// UNSIGNED RELEASES: with no Developer ID identity (release.yml's unsigned
// path sets LH_ADHOC_SIGN=1 and electron-builder skips signing), the bundle
// would keep a broken seal — the shell edits Info.plist and renames the
// executable — and an Apple Silicon Mac refuses to run it even after the
// quarantine flag is cleared. An ad-hoc signature (`-`, no certificate, no
// Apple account) restores a valid seal; Gatekeeper still asks the user to
// allow the app once.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") return;
	const appBundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
	const target = path.join(appBundle, "Contents", "Resources", "icon.icns");
	const source = path.join(context.packager.info.projectDir, "build", "icon.icns");
	fs.copyFileSync(source, target);
	console.log(`[after-pack] pre-Tahoe fallback icns (full-res) → ${target}`);
	if (process.env.LH_ADHOC_SIGN !== "1") return;
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", appBundle], { stdio: "inherit" });
	console.log(`[after-pack] ad-hoc signed ${appBundle}`);
};
