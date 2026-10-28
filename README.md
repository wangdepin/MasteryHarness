# MasteryHarness

**An agent harness for learning. A fork of [LearnHarness](https://github.com/amosblomqvist/learnharness).**

<p>
  <a href="#whats-different-in-this-fork">What's different</a> ·
  <a href="#review">Review</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#install">Install</a> ·
  <a href="docs/development.md">Documentation</a> ·
  <a href="https://github.com/wangdepin/MasteryHarness/issues">Issues</a> ·
  <a href="https://discord.gg/5tCHHQEB2e">Discord</a>
</p>

> MasteryHarness is a fork of LearnHarness by Amos Blomqvist and tracks its main branch. It is not affiliated with or endorsed by the upstream project. The teaching engine, knowledge graph, and most of the app are upstream's work; the changes listed below are this fork's.

MasteryHarness uses AI agents to plan and teach lessons from your current understanding to your goal. It builds a detailed picture of what you understand and how you reason, and updates it as you learn. Teaching builds understanding one reasoning step at a time, practice makes it usable, and a persistent knowledge graph carries it across sessions.

**Bring your own model access, two ways.** Paste an API key for any of many providers (OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, and more), or skip the key and **sign in with an existing ChatGPT, Claude, GitHub Copilot, Grok, or Google (Gemini) subscription**. Nothing goes through a MasteryHarness server; the app talks to your provider directly.

![Teaching session](docs/assets/teaching-session.png)

## What's different in this fork

- **Review: spaced repetition for what you have learned.** A Review page in the sidebar lists the propositions whose recall is due, scheduled by FSRS-6 from your practice results. Pick some, start a review, and the next practice session is built around them. [Details below](#review).
- **Code exercises.** The teacher can pose a Python exercise in the dock: you write code, run it in the app (a bundled Pyodide runtime, no network needed), and submit only after running the current code. A "Your thinking" field carries your reasoning to the teacher.
- **Sign in with a subscription instead of an API key.** Use your ChatGPT, Claude, GitHub Copilot, Grok, or Google subscription. In the desktop app, ChatGPT, GitHub Copilot, and Grok connect from the Subscriptions section of Settings → Keys; Copilot and Grok show a device code and an Open browser button to finish the sign-in. Which Copilot models you see follows your account's and organization's policy. Claude and Google sign-in are listed below it; Google goes through Antigravity, which offers Gemini, Claude, and GPT-OSS models, and its models appear in the picker once you are signed in.
- **Claude Code as a model provider.** If the `claude` CLI is installed and signed in, `claude-code` appears in the model picker with opus, sonnet, and haiku, billed to your Claude subscription instead of an API key. Each turn runs `claude -p` in an isolated, tool-less directory, and the harness's own tools are handed to it over a loopback-only MCP server. This comes from [upstream PR #61](https://github.com/amosblomqvist/learnharness/pull/61), which is still open upstream. A packaged app starts with a short `PATH`; if the picker does not list `claude-code`, the CLI was not found.
- **Pin and archive sessions.** Right-click a session to pin it: pinned sessions stay in a Pinned group at the top of the list whatever the Teaching / Practice / All filter says. Archive a finished session and it folds into an "Archived (n)" group at the bottom, still found by search. Sending a message to an archived session brings it back.
- **Sentence reader.** Read teaching text sentence by sentence, with optional read-aloud through ElevenLabs.
- **Quote while you read.** Selecting teaching prose quotes it into "Thinking while reading" automatically, including in prediction questions.
- **Light theme.** A light theme and a System mode in appearance settings. The plan map follows the theme.
- **Copy formulas as TeX.** Copy any rendered KaTeX formula back out as TeX source.
- **Answer fields.** Cmd+Enter submits; Enter inserts a newline.
- **Packaging and fixes.** The packaged server ships pi-ai's OAuth flow modules, the researcher gets a wrap-up turn when it spends every turn on tools, and literal `\n` in questions and one-line code fences renders correctly.
- **A new app icon.** The M graph mark, redrawn as vector for the macOS Liquid Glass icon, the Windows and Linux icons, and the sidebar.

Everything else behaves as in upstream. See the [commit history](https://github.com/wangdepin/MasteryHarness/commits/main) for the exact changes.

## Review

Learning that is not revisited fades. Review brings each proposition back when you are about to forget it, using the practice sessions you have already done.

- **Where it lives.** The **Review** row in the sidebar, under Practice, with a count of what is due now. The page lists due propositions, most overdue first, and what comes up later.
- **Run a review.** The most overdue propositions (up to 8) are pre-selected; tick or untick to change the set, then **Start review**. That opens an ordinary practice session on exactly those propositions. How it goes becomes the next schedule.
- **How it is scheduled.** [FSRS-6](https://github.com/open-spaced-repetition/ts-fsrs) with its default weights and a 90% target recall. A solve with no hint pushes a proposition far out; a failure brings it back soon.
- **Nothing extra to maintain.** The schedule is recomputed from your practice sessions each time you open the page. No review queue is stored, so deleting a practice session also removes its evidence.
- **Slips are not forgetting.** The teacher labels each miss. If you knew the idea and made a careless or mechanical slip, the proposition still counts as recalled.
- **One failure is not a verdict.** If you fail a proposition you knew well, the schedule is left untouched and the row is marked **re-check**; it returns the next day. Anything after the failure in the same session is ignored, because you had just seen the answer. A later session decides: failing again counts as forgetting, a success counts, capped at "hard".

Design notes: [docs/review-plan.md](docs/review-plan.md).

## How it works

This is upstream's design, summarized.

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on.
2. **Plan.** It works out a dependency map from that starting point to your goal, and adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand: you predict, get an explanation, and check your understanding.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first.
5. **Review.** (This fork.) Propositions you have practiced come back on a schedule, before you forget them.

What you are taught accumulates in a knowledge graph of propositions and reasoning chains, with links back to the source sessions. Future teaching and practice sessions read from it instead of starting from scratch.

![Knowledge graph](docs/assets/knowledge-graph.png)

The screenshots are from upstream's interface.

## Install

**Prebuilt installers:** see [Releases](https://github.com/wangdepin/MasteryHarness/releases). The macOS build is **unsigned** (there is no paid Apple developer certificate behind it), so macOS blocks the first launch. Unsigned builds do not update in-app; download the new version instead.

**macOS: "MasteryHarness is damaged and can't be opened"?** The app is not damaged. macOS shows this for any unsigned app downloaded from the internet. Drag MasteryHarness from the DMG into Applications, then clear the download quarantine flag in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/MasteryHarness.app
```

Then open the app again. Alternatively, open **System Settings → Privacy & Security** and click **Open Anyway** after the first blocked launch. If the DMG itself will not open, run the same command on the downloaded file first, for example `xattr -dr com.apple.quarantine ~/Downloads/MasteryHarness-0.4.0-arm64.dmg`.

Or build from source:

```bash
git clone https://github.com/wangdepin/MasteryHarness.git
cd MasteryHarness
npm install
npm run dev        # http://localhost:3000
npm test           # deterministic, no LLM, no network
```

See the [development guide](docs/development.md), [architecture](docs/architecture.md), and [desktop release guide](docs/desktop-release.md).

Want the official app? Download LearnHarness from [learnharness.ai](https://learnharness.ai).

## Your keys, your data

- **Your keys and models.** No subscription or markup. Add an API key and pay your provider for usage, or sign in with an existing ChatGPT, Claude, GitHub Copilot, Grok, or Google subscription. Both are set up in Settings.
- **Local storage.** Your chats, graph, settings, and credentials live on your machine. Learning records are plain files you can inspect.
- **External services.** Models run through your configured providers. Model requests send the context needed for the task; web research, dictation, and read-aloud also contact external services. Local storage does not mean offline processing.
- **Inspectable behavior.** System prompts are visible and editable.

## Relationship to upstream

MasteryHarness tracks [LearnHarness](https://github.com/amosblomqvist/learnharness) and last merged upstream 0.3.8. Credit for the original app goes to Amos Blomqvist. Model access is built on [pi-ai](https://github.com/earendil-works/pi).

## License

[AGPL-3.0](LICENSE), unchanged from upstream. As the license requires, modified source stays available under the same terms.
