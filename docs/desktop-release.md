# Desktop builds and releases

## Platforms

| Platform | Build runner | Packages | In-app update |
|---|---|---|---|
| macOS, Apple Silicon | `macos-26` (arm64) | DMG + ZIP — signed/notarized when the secrets below exist, otherwise unsigned with an ad-hoc seal | ZIP via Squirrel.Mac (signed builds only; see [Unsigned macOS builds](#unsigned-macos-builds)) |
| Windows, x64 | `windows-2025` | unsigned per-user NSIS installer | NSIS |
| Linux, x64 | `ubuntu-24.04` | AppImage + `.deb` | AppImage replacement; `.deb` through dpkg/apt with elevation if needed |

Windows signing is deliberately disabled. SmartScreen may warn about an unknown publisher on initial installation. AppImage is the primary Linux download because it is self-contained and updates without administrator permission. `.deb` updates may request an administrator password. Both use the same download/restart banner. Package targets and signing settings live in [`electron-builder.yml`](../electron-builder.yml); see [`package.json`](../package.json) and the lockfile for current tool versions.

The custom app bar stays on all three platforms. macOS keeps its left-side traffic lights; Windows/Linux use Electron's native right-side Window Controls Overlay, with CSS space reserved from the overlay's actual geometry. Windows/Linux hide the native menu until Alt is pressed. macOS keeps its system menu.

Icons are per-platform (2026-10-13): macOS compiles the Icon Composer document `build/icon.icon` via actool into `Assets.car` (macOS 26 Liquid Glass) plus a fallback icns that `scripts/after-pack.cjs` replaces with the hand-packed full-res `build/icon.icns` (actool's caps at 256px); Windows embeds `build/icon.ico` and Linux uses `build/icon.png`, both generated from the flat design (`build/icon-flat.svg`) by `node scripts/make-icons.mjs`. Building the mac icon needs **macOS 26+ and Xcode 26+** (`actool`): Xcode 26's asset compiler crashes on macOS 15 because its host frameworks lack required symbols. `desktop:dist` injects `DEVELOPER_DIR` locally; release packaging uses `macos-26` and selects Xcode via setup-xcode. The older-OS fallback icon remains included. Linux's desktop identity is `learnharness.desktop`. Public package-maintainer metadata uses the owner's GitHub no-reply address; support goes through [GitHub Issues](https://github.com/wangdepin/MasteryHarness/issues).

## Build pipeline

CI uses Node 26. Each OS installs its own dependencies and builds its own Next standalone tree:

1. `npm ci`
2. Native PDF/SVG renderer and browser-service tests for that OS, running in Electron's bundled Node (no display needed).
3. `npm run build` (`output: "standalone"`).
4. `node scripts/smoke-provider-runtime.mjs` — check the fresh trace before curation: offline evaluation of all ten native Pi chat implementations, lazy Google/Bedrock initialization, and public GitHub Copilot/xAI OAuth-to-auth paths. Payload hooks stop before generation; this is not a live provider/login check.
5. `node scripts/build-server.mjs` — copy static assets, refuse leaked learning data and credential files, remove only standalone-root `dist/` and `node_modules/electron/` (old installers and the development runtime), and check prompt assets.
6. `node scripts/smoke-server.mjs --electron` — exercise demo dependencies, offline provider initialization, and gzip backpressure in Electron's bundled Node; boot the standalone server using throwaway data/auth and check `/`, `/api/graph`, `/api/models`, and `/api/settings`.
7. `npx electron-builder <platform flags> --publish <policy>` — package for the current OS using the local/rehearsal or tag-release policy below.

The shell/updater live in `app.asar`; the standalone server and native renderer binaries ship unpacked as `extraResources`. **Do not cross-build the server payload.** Next traces the build machine's native binaries, so a macOS-built standalone tree is not a Windows/Linux payload.

The release workflow additionally initializes providers from the **packaged** payload under both host Node and the packaged Electron runtime, then exercises the demo browser helper using the app's own Electron (Linux uses Xvfb). Successful HTTP boot or a model catalog alone does not prove those lazy runtime paths work.

### Runtime tracing and image payloads

[`next.config.ts`](../next.config.ts) keeps Pi, PDF.js, canvas, resvg, and Photon external and explicitly includes dynamically loaded catalogs, OAuth modules, renderer binaries, image workers, and Photon WASM. Broad `dist/**` or `data/**` exclusions can strip legitimate dependencies; keep the narrow tracing rules and post-trace curation in [`build-server.mjs`](../scripts/build-server.mjs). That script refuses known root data/secret leaks; it is not a substitute for inspecting a changed payload.

Image resizing uses the shipped Photon 0.3.4 JS/WASM engine and unbundled worker, alongside native canvas PDF and resvg SVG rendering. [`smoke-image-runtime.mjs`](../scripts/smoke-image-runtime.mjs) is an additional focused offline check, **not currently invoked by CI/release workflows**: it generates a synthetic PNG and proves in-process and worker resizing resolve inside the standalone payload. It accepts `--standalone <dir>` and `--runtime <Node-or-Electron-binary>` like the provider probe. No real provider or personal image is needed.

### Local packaging

`npm run desktop:dist` is the local macOS signing path, using the `LH_NOTARY` keychain profile. It clears local `dist` and `.next/standalone`, builds, checks the fresh provider trace, curates the payload, runs the server smoke under host Node, then packages. Unlike CI's `--electron` smoke, that script does not itself check Electron's Node runtime or run the post-package probes. It has no publish flag and is not the tag-upload workflow.

For a local Windows/Linux build, run steps 1–6 above, then:

```sh
# On Windows:
npx electron-builder --win --x64 --publish never

# On Linux:
npx electron-builder --linux --x64 --publish never
```

## CI vs release

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on main pushes, pull requests, and manual dispatch:

- Typecheck, full deterministic test suite, and lint on Ubuntu.
- Native renderer/browser-service tests, fresh-trace provider gate, and standalone build/boot-smoke on macOS (`macos-15`), Windows, and Linux. This macOS job does not compile the Icon Composer asset; only release packaging needs the newer runner.

[`.github/workflows/release.yml`](../.github/workflows/release.yml) has two deliberately separate modes:

- **Manual / Run workflow:** unsigned rehearsal installers saved as workflow artifacts for 7 days. No signing secrets needed, no release created, and nothing published. macOS notarization is skipped. Use the Windows/Linux artifacts for the first human smoke pass. These are not production macOS installers.
- **Push `v<package.json version>`:** gates first, then one job creates or reuses a **single draft GitHub Release** before the three OS jobs package/upload their artifacts and update metadata in parallel. This avoids competing draft creation. A published or ambiguous existing release fails the preparation step instead of being modified. Separate runs for the same ref are serialized, never cancelled mid-upload. The tag must match the package version. macOS signs and notarizes when **all five** secrets exist, builds unsigned when **none** exist, and fails loudly on a partial set. The workflow never publishes the draft. After all three packaging jobs succeed, a final read-only **Verify draft release** job (below) fails the run unless that draft is complete and self-consistent.

The three jobs upload distinct updater feeds: `latest-mac.yml`, `latest.yml`, `latest-linux.yml`, with the matching ZIP/NSIS/AppImage/deb assets and blockmaps. **A partially populated draft is never fit to publish — and the final job enforces it mechanically.** The app reads the public GitHub release feed anonymously; no release token is baked into the app. Draft uploads are not public updates. **Only the owner publishes the verified draft.**

### The verification job

`verify` runs only on tag pushes (`needs: package`, so after **all three** packaging legs; manual rehearsals create no draft and skip it). It checks out the tagged revision without persisting credentials and runs [`scripts/verify-release.ts`](../scripts/verify-release.ts). GitHub requires push access to list **draft** releases, so this job needs `contents: write` even though every API operation is GET-only. The token is exposed only to the release-list and feed-download steps, not dependency installation or the offline validator. The validator:

- finds the draft using the same tag matching as the draft job and electron-builder's publisher — `tag_name` equals `v<version>` **or** the bare `<version>`; zero matches, two matches, or an already-published match fail the run, and a draft matched only via the unprefixed form is flagged with a warning (a later run could create a second draft under the `v`-tag and split the assets — rename before publishing);
- fails unless the release holds **exactly** these 11 assets — nothing missing, nothing extra (a stale name from an older run is an error), nothing zero-size, nothing still in a non-`uploaded` state:

| Asset | Role |
|---|---|
| `MasteryHarness-<v>-arm64.dmg` + `.blockmap` | macOS installer |
| `MasteryHarness-<v>-arm64-mac.zip` + `.blockmap` | macOS updater payload (Squirrel.Mac installs from the ZIP) |
| `MasteryHarness-<v>-x64-setup.exe` + `.blockmap` | Windows NSIS installer |
| `MasteryHarness-<v>-x86_64.AppImage` | Linux AppImage (no sidecar blockmap) |
| `MasteryHarness-<v>-amd64.deb` | Linux deb (no sidecar blockmap) |
| `latest-mac.yml` / `latest.yml` / `latest-linux.yml` | updater feeds |

  (The Linux names are deliberate: `linux.artifactName` applies to both targets, and `${arch}` expands to `x86_64` for AppImage and `amd64` for deb. The validator fails closed if `electron-builder.yml` drifts from the verified shapes.);
- downloads the three feeds from the draft and fails unless each parses, carries the `package.json` version, and references **exactly** the uploaded assets — by bare file name only (no paths, traversal, or URLs), with sizes matching the API-reported asset sizes, the ZIP first in `latest-mac.yml`, and the legacy top-level `path`/`sha512` backed by that first entry.

The job only reads (release list + asset downloads); it never creates, edits, publishes, or deletes anything.

## Unsigned macOS builds

Signing needs a paid Apple Developer account, so it is optional. With no signing secrets the macOS job runs `electron-builder` with `-c.mac.identity=null -c.mac.notarize=false` and `LH_ADHOC_SIGN=1`; `scripts/after-pack.cjs` then ad-hoc signs the bundle (`codesign --force --deep --sign -`). Without that seal an Apple Silicon Mac refuses to run the app, because the shell edits `Info.plist` and renames the executable.

What users see:

- Gatekeeper blocks the first launch. Allow it once under **System Settings → Privacy & Security → Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/MasteryHarness.app`.
- **No in-app update.** Squirrel.Mac only installs a signed update, so unsigned builds are updated by downloading the new DMG from the Releases page.

## macOS CI secrets (optional)

Add these under repository **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | Base64-encoded Developer ID Application `.p12` backup, including its private key |
| `MAC_CSC_KEY_PASSWORD` | Password protecting that `.p12` |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | `JS6XN22HY6` |

The workflow maps the certificate secrets to electron-builder's `CSC_LINK` / `CSC_KEY_PASSWORD`. GitHub's built-in `GITHUB_TOKEN` supplies `GH_TOKEN` with job-scoped `contents: write`; no separate GitHub token secret is required. Signing credentials are present only for the packaging step, not the Next build. Never commit certificates, passwords, or `.env.local`.

## Release runbook

1. Push the implementation; run the manual Desktop release workflow.
2. Human smoke on Windows/Linux: install/open, window buttons and dragging, sidebar at narrow widths, zoom, setup/keys, session/resume, native PDF/SVG verification and demo helper. The macOS rehearsal is unsigned (ad-hoc sealed); the signed production path only runs when the secrets exist.
3. Optional: add macOS signing/notarization secrets. Without them the release ships an unsigned macOS build.
4. Bump `package.json` and the lockfile to the agreed release version; run local gates and push a matching `v...` tag.
5. Wait for **all three** packaging jobs **and the final Verify draft release job** — the gate mechanically checks the draft's 11 assets and the three update feeds (single draft, right names/version/sizes/upload state, feeds referencing only what the release actually holds). If it fails, fix the cause and re-run the workflow before publishing; electron-builder replaces same-named assets on re-upload, and the gate rejects leftovers.
6. Owner makes the repository public, publishes the complete draft, then checks the real GitHub update path using a prior installed version.
7. If you need to edit the draft's metadata, **include the explicit canonical `tag_name: "v<version>"` in every metadata PATCH**, even when changing only the title/body. Omitting it has reset release tags in past releases. Re-read the draft afterward to confirm tag identity, draft status, and assets. A tag correction is a metadata change, not permission to delete/recreate a release.

Changes to the shell, native modules, packaging/updater configuration, or Electron itself warrant relevant platform smoke checks: install/open, window controls/dragging, zoom, setup and session resume, native PDF/SVG tools, and the demo helper. Offline fixture gates prove their exercised paths, not real account/provider functionality; do not repeat already accepted feature testing without a concrete risk.

## In-app updates and website notification

Packaged apps check at startup and every 24 hours by default, download available updates automatically, and install downloaded updates on quit or through Restart. **Settings → General** shows version/release notes, manual Check for updates, status, and Automatic updates. Turning automatic checks off does not cancel downloads or staged installs; a manual check still downloads available updates. Development builds disable the updater. Errors are logged to `userData/logs/main.log` without taking down the app. The test-only `LH_UPDATE_FEED` environment override points to a generic feed for an authorized local update drill.

Sources: [`electron/main.cjs`](../electron/main.cjs), [`electron/preload.cjs`](../electron/preload.cjs), and [`update-settings.tsx`](../components/settings/update-settings.tsx).

After a stable release is published, [`.github/workflows/notify-website.yml`](../.github/workflows/notify-website.yml) dispatches `desktop-release-published` with the tag to `amosblomqvist/learnharness-web`, using the separately scoped `WEBSITE_DISPATCH_TOKEN` secret. Drafts and prereleases do not trigger that job. A successful HTTP 204 means the website update was **queued**, not that deployment or public links have been verified.
