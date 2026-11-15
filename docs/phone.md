# Using MasteryHarness from an iPhone

MasteryHarness has no phone app. Instead, one long-lived server on your Mac (the **resident server**) serves the same web app to the Mac's browser and to the iPhone, over your private Tailscale network. Both see the same lessons, because there is only one copy of the data: the desktop app's own folder on the Mac.

```
iPhone Safari ──(Tailscale, HTTPS)──┐
                                    ├──▶ resident server ──▶ ~/Library/Application Support/MasteryHarness/
Mac browser ──(localhost:4747)──────┘
```

This is single-owner hosting. Everyone who pairs a device sees every chat and setting.

## What protects it

- **Tailscale.** The server listens on `127.0.0.1` only. Tailscale Serve is the only way in from another device, and only devices signed in to your tailnet can reach it. Nothing is exposed to the public internet.
- **The access gate.** With `LH_ACCESS_TOKEN` set, every page and API route needs a paired device. A device pairs once by pasting the token into the form the server shows it; after that it holds a signed cookie for 400 days. Changing the token signs every device out.

The gate is off when `LH_ACCESS_TOKEN` is unset, and the server then behaves as it always has. The resident server refuses to start without a valid token.

## One rule

**Never run the desktop app and the resident server at the same time.** They write the same files. The resident server checks at start and waits while the desktop app is open, but nothing stops you opening the desktop app while the server runs. Open the desktop app only through the **MasteryHarness Desktop** launcher (see [Using the desktop app](#using-the-desktop-app)), which stops the server first.

## Set up once

All commands run from the repo root.

1. **Build and install a release.**

   ```sh
   npm ci && npm run plugins:setup
   npm run build && node scripts/build-server.mjs && node scripts/smoke-server.mjs
   node scripts/resident-server/deploy.mjs
   ```

   The release is copied to `~/Library/Application Support/MasteryHarness-server/releases/` and `current` points at it.

2. **Write the settings.** Copy the template, make it private, and fill it in:

   ```sh
   cd ~/Library/Application\ Support/MasteryHarness-server
   cp /path/to/repo/scripts/resident-server/resident-server.env.example server.env
   chmod 600 server.env
   openssl rand -hex 32     # paste the result as LH_ACCESS_TOKEN
   ```

   Set `LH_DATA_DIR` and `LH_AUTH_FILE` to your own home folder, and `LH_ALLOWED_HOSTS` to the name from step 4. Keep the token in a password manager: every device needs it once.

3. **Quit the desktop app, then install the login item.**

   ```sh
   node scripts/resident-server/launch-agent.mjs install
   curl http://127.0.0.1:4747/api/health      # {"ok":true,"version":"…","tokenMode":true}
   ```

   The server now starts at login and restarts if it exits. Its log is `~/Library/Logs/MasteryHarness-server/server.log`.

4. **Open it to your tailnet.** In the Tailscale admin console, enable MagicDNS and HTTPS certificates. Then:

   ```sh
   tailscale up
   tailscale serve --bg 4747
   tailscale serve status       # shows https://<mac>.<tailnet>.ts.net
   ```

   Put that host name in `LH_ALLOWED_HOSTS` and restart the server (`launchctl kickstart -k gui/$(id -u)/com.masteryharness.server`).

5. **Pair the Mac's browser.** Open `http://localhost:4747`, paste the token. Let the browser save it.

6. **Pair the iPhone.** Install Tailscale on the phone and sign in to the same account. In Safari open `https://<mac>.<tailnet>.ts.net`, paste the token, then Share → Add to Home Screen. The home-screen app may ask for the token once more; it keeps its own cookies.

7. **Install the desktop app and its launcher.** Package the server built in step 1 as an unsigned desktop app, copy it to `/Applications`, then build the launcher next to it:

   ```sh
   DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer LH_ADHOC_SIGN=1 \
     npx electron-builder --mac --arm64 --dir --publish never \
     -c.mac.identity=null -c.mac.notarize=false -c.directories.output=dist/local
   ditto dist/local/mac-arm64/MasteryHarness.app /Applications/MasteryHarness.app
   node scripts/resident-server/desktop-launcher.mjs install
   ```

   Put `/Applications/MasteryHarness Desktop.app` in the Dock instead of the desktop app itself. To update the desktop app later, quit it, delete `/Applications/MasteryHarness.app` and repeat this step: `ditto` onto an existing app merges the two.

Model sign-ins made in the desktop app carry over: the server reads the same files. To sign in again, do it in the Mac's browser at `http://localhost:4747`, because ChatGPT's sign-in calls back to the server's own machine.

## After merging upstream

```sh
npm ci && npm run plugins:setup
npm run typecheck && npm test && npm run lint
npm run build && node scripts/build-server.mjs && node scripts/smoke-server.mjs
node scripts/resident-server/deploy.mjs
launchctl kickstart -k gui/$(id -u)/com.masteryharness.server
curl http://127.0.0.1:4747/api/health        # check the version
```

Each release is about 250 MB and older ones are kept so you can roll back (re-point `current` and restart). Delete the ones you no longer want from `releases/`.

## Using the desktop app

Open **MasteryHarness Desktop**, not MasteryHarness. The launcher:

1. stops the resident server, and waits until it no longer answers;
2. opens the desktop app, and waits until it holds the data;
3. loads the server's login item again.

The server then refuses to start every 30 seconds while the desktop app is open, and starts by itself within 30 seconds of quitting it. There is nothing to switch back.

While the desktop app is open the phone cannot connect, and a lesson the phone was in the middle of is cut off. If the launcher shows an alert, the server is left stopped; the alert gives the command that starts it again.

The launcher keeps its own copy of `scripts/resident-server/`. After those scripts change, run `node scripts/resident-server/desktop-launcher.mjs install` again. `node scripts/resident-server/launch-agent.mjs uninstall` removes the server's login item altogether.

## Reading size on the phone

Settings → Appearance → Reading font size is shared: the phone and the Mac read it from the same settings file. On a touch screen a row under it, **This device**, sets a size for that phone alone (12–24 px). It is kept in the phone's browser storage, so the Mac is unaffected; leave it empty to follow the shared size. Pinch-zoom still works, but a zoomed page pans sideways until you zoom back out.

## When something is wrong

| What you see | Cause and fix |
| --- | --- |
| The phone cannot reach the site | Tailscale is off on the phone, the Mac is asleep, or the server is stopped. Check `curl http://127.0.0.1:4747/api/health` on the Mac. |
| The log repeats "the MasteryHarness desktop app is open" | The desktop app is running. Quit it; the server starts within 30 seconds. |
| The log says "not starting:" with a list | A setting in `server.env` is missing or malformed. Each line names one. |
| Every page says 503 | `LH_ACCESS_TOKEN` is not 64 hexadecimal characters. |
| "host not allowed" | The name in the address bar is missing from `LH_ALLOWED_HOSTS`. |
| The pairing form comes back with "Too many attempts" | Five wrong tokens in a minute block pairing for everyone. Wait a minute. |
| A link opened from another app shows the pairing form | The cookie is not sent on a navigation that starts on another site. Reload the page. |
| Saving anything fails with "cross-origin write" | The page was opened over plain HTTP by name. Use the `https://…ts.net` address, or `http://localhost:4747` on the Mac. |

## Limits

- The Mac must be awake. A sleeping Mac serves nothing.
- No offline use and no notifications: there is no service worker.
- A lost phone is signed out only by changing the token, which signs out every device.
- Attaching a file by its path works only in the desktop app. Upload source material instead.
- Coding questions and demos run on the Mac, with the Mac's own runtimes and Chrome.
