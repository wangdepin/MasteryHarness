# MasteryHarness

**An agent harness for learning. A fork of [LearnHarness](https://github.com/amosblomqvist/learnharness).**

<p>
  <a href="#whats-different-in-this-fork">What's different</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#install">Install</a> ·
  <a href="https://github.com/wangdepin/MasteryHarness/issues">Issues</a>
</p>

> MasteryHarness is a fork of LearnHarness by Amos Blomqvist and tracks its main branch. It is not affiliated with or endorsed by the upstream project. The teaching engine, knowledge graph, and most of the app are upstream's work; the changes listed below are this fork's.

MasteryHarness uses AI agents to plan and teach lessons from your current understanding to your goal. It builds a detailed picture of what you understand and how you reason, and updates it as you learn. Teaching builds understanding one reasoning step at a time, practice makes it usable, and a persistent knowledge graph carries it across sessions.

![Teaching session](docs/assets/teaching-session.png)

## What's different in this fork

- **Subscription sign-in.** Use your ChatGPT, Claude, or Google Antigravity (Gemini, Claude, GPT-OSS) subscription instead of an API key. Antigravity models appear in the picker once you are signed in.
- **Sentence reader.** Read teaching text sentence by sentence, with optional read-aloud through ElevenLabs.
- **Quote while you read.** Selecting teaching prose quotes it into "Thinking while reading" automatically, including in prediction questions.
- **Light theme.** A light theme and a System mode in appearance settings. The plan map follows the theme.
- **Copy formulas as TeX.** Copy any rendered KaTeX formula back out as TeX source.
- **Answer fields.** Cmd+Enter submits; Enter inserts a newline.
- **Packaging and fixes.** The packaged server ships pi-ai's OAuth flow modules, the researcher gets a wrap-up turn when it spends every turn on tools, literal `\n` in questions and one-line code fences renders correctly, and `pi-ai` / `pi-agent-core` are bumped to 1.3.0.

Everything else behaves as in upstream. See the [commit history](https://github.com/wangdepin/MasteryHarness/commits/main) for the exact changes.

## How it works

This is upstream's design, summarized.

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on.
2. **Plan.** It works out a dependency map from that starting point to your goal, and adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand: you predict, get an explanation, and check your understanding.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first.

What you are taught accumulates in a knowledge graph of propositions and reasoning chains, with links back to the source sessions. Future teaching and practice sessions read from it instead of starting from scratch.

![Knowledge graph](docs/assets/knowledge-graph.png)

The screenshots are from upstream's interface.

## Install

**Prebuilt installers:** see [Releases](https://github.com/wangdepin/MasteryHarness/releases). The macOS build is **unsigned**, so the first launch is blocked by Gatekeeper: open **System Settings → Privacy & Security → Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/MasteryHarness.app`. Unsigned builds do not update in-app; download the new version instead.

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

- **Your keys and models.** No subscription or markup. You pay your providers for usage, or sign in with an existing subscription.
- **Local storage.** Your chats, graph, settings, and credentials live on your machine. Learning records are plain files you can inspect.
- **External services.** Models run through your configured providers. Model requests send the context needed for the task; web research, dictation, and read-aloud also contact external services. Local storage does not mean offline processing.
- **Inspectable behavior.** System prompts are visible and editable.

## Relationship to upstream

MasteryHarness tracks [LearnHarness](https://github.com/amosblomqvist/learnharness) and last merged upstream 0.3.2. Credit for the original app goes to Amos Blomqvist. Model access is built on [pi-ai](https://github.com/earendil-works/pi).

## License

[AGPL-3.0](LICENSE), unchanged from upstream. As the license requires, modified source stays available under the same terms.
