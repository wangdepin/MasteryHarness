/**
 * Keyboard shortcuts (shortcut wave, 2026-09-17) — the single source of truth
 * for every app action that has a binding. This module is PURE (no React, no
 * window access at module scope beyond the guarded helpers) so it can render
 * a cheat sheet, match events, and — at the settings milestone — drive a
 * user-editable key map without touching any component.
 *
 * Design (owner-approved plan):
 * - Tab is DEAD: browser tab-focus navigation is abandoned entirely. Tab
 *   does nothing; Shift+Tab alone cycles the thinking level.
 * - Esc is a layered dismiss: topmost popover (each popover stopPropagation's
 *   its own Esc) → dictation stop → abort in-flight turn.
 * - The key map persists overrides in localStorage (`lh:keymap`, overrides
 *   only) merged over DEFAULT_BINDINGS — the settings wave adds the editor.
 *
 * Binding strings are normalized, cross-platform:
 *   "mod+d"    — mod = ⌘ on macOS, Ctrl elsewhere (both are accepted live)
 *   "shift+tab", "alt+arrowdown", "mod+shift+f", "?", "f2", "escape"
 * Order is fixed: mod, alt, shift, then the key.
 * A bare letter typed with Shift keeps its case ("G" is not "g"); a binding of
 * space-separated steps ("g g") is a key sequence (see advanceSequence).
 */

export type KeyAction =
	| "toggle-dictation"
	| "open-model-picker"
	| "cycle-thinking"
	| "toggle-sidebar"
	| "sessions-search"
	| "jump-graph"
	| "new-session"
	| "rename-session"
	| "cheat-sheet"
	| "find"
	| "question-focus"
	| "question-next-row"
	| "question-prev-row"
	| "question-pick-row"
	| "question-submit"
	| "open-settings"
	| "toggle-user-thinking"
	| "read-by-sentence"
	| "scroll-top"
	| "scroll-bottom";

/** Where the cheat sheet groups an action (display only — dispatch is
 *  global; a seam that isn't mounted simply no-ops). */
export type KeyScope = "global" | "chat" | "graph";

export interface KeyActionDef {
	id: KeyAction;
	/** Cheat-sheet label. */
	label: string;
	scope: KeyScope;
	binding: string;
	/** Display-only (cheat sheet) — contextual keys a SURFACE owns (the
	 *  question dock's row machine); never dispatched from the registry,
	 *  so they can't leak to pages where the surface isn't mounted. */
	displayOnly?: boolean;
	/** Dispatched, but not rebindable in settings (a key sequence: the
	 *  rebind capture records one combo at a time). */
	fixed?: boolean;
}

export const KEYBOARD_ACTIONS: readonly KeyActionDef[] = [
	{ id: "toggle-dictation", label: "Toggle dictation", scope: "global", binding: "mod+d" },
	{ id: "open-settings", label: "Open settings", scope: "global", binding: "mod+," },
	{ id: "open-model-picker", label: "Model selector", scope: "global", binding: "mod+k" },
	{ id: "cycle-thinking", label: "Cycle thinking level", scope: "global", binding: "shift+tab" },
	{ id: "toggle-sidebar", label: "Toggle sessions sidebar", scope: "global", binding: "mod+b" },
	{ id: "sessions-search", label: "Search sessions", scope: "global", binding: "mod+shift+f" },
	// (The Alt+↑/↓/↵ session cycle was RETIRED, owner 2026-10-10: barely
	// used, felt laggy. Session navigation lives IN the search now — ↑/↓
	// walk the filtered list, Enter opens (first match when nothing
	// walked) — see sidebar.tsx's search input.)
	{ id: "jump-graph", label: "Graph view", scope: "global", binding: "mod+g" },
	{ id: "new-session", label: "New session", scope: "global", binding: "mod+n" },
	{ id: "rename-session", label: "Rename session", scope: "chat", binding: "f2" },
	{ id: "toggle-user-thinking", label: "Toggle all your thinking", scope: "chat", binding: "mod+t" },
	// Mod+F is surface-scoped: graph node search and session text Find share
	// one action/binding. Only the currently mounted surface listens.
	{ id: "find", label: "Find", scope: "global", binding: "mod+f" },
	{ id: "read-by-sentence", label: "Read latest passage by sentence", scope: "chat", binding: "mod+r" },
	// Vim-style session edges. Bare keys: they fire only outside typing
	// surfaces (the dispatcher's input guard), so Esc out of the composer first.
	{ id: "scroll-top", label: "Jump to session start", scope: "chat", binding: "g g", fixed: true },
	{ id: "scroll-bottom", label: "Jump to session end", scope: "chat", binding: "G", fixed: true },
	{ id: "cheat-sheet", label: "Shortcut cheat sheet", scope: "global", binding: "?" },
	// The question dock's row machine (wave B) — displayOnly: the dock owns
	// the keys while a question is expanded; the registry never dispatches
	// them, so bare arrows stay free everywhere else.
	{ id: "question-focus", label: "Question · focus thinking ↔ rows", scope: "chat", binding: "tab", displayOnly: true },
	// (The model-menu entries — "walk results" ↑/↓, "pick result" ↵ — were
	// REMOVED, owner 2026-10-10: obvious in-field menu navigation, never
	// dispatched, never rebindable — not settings material. The menu's own
	// arrow machine (menu-shell.tsx) is unchanged.)
	{ id: "question-next-row", label: "Question · next row", scope: "chat", binding: "arrowdown", displayOnly: true },
	{ id: "question-prev-row", label: "Question · previous row", scope: "chat", binding: "arrowup", displayOnly: true },
	{ id: "question-pick-row", label: "Question · pick row", scope: "chat", binding: "space", displayOnly: true },
	{ id: "question-submit", label: "Question · submit", scope: "chat", binding: "enter", displayOnly: true },
];

const STORAGE_KEY = "lh:keymap";

/** localStorage overrides ({actionId: binding}) — read once per module
 *  instance; the settings editor will write this key. Guarded: SSR and a
 *  corrupt/absent store both fall back to defaults. */
export function loadOverrides(): Partial<Record<KeyAction, string>> {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Partial<Record<KeyAction, string>>;
		if (parsed && typeof parsed === "object") return parsed;
	} catch {
		/* corrupt store = defaults */
	}
	return {};
}

/** Write the full overrides map ({actionId: binding}) — the settings
 *  editor's rebind/reset persistence. Guarded: SSR no-ops. An empty
 *  map clears the store entirely (all-defaults). */
export function saveOverrides(overrides: Partial<Record<KeyAction, string>>): void {
	if (typeof window === "undefined") return;
	try {
		if (Object.keys(overrides).length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
		else window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* storage unavailable = overrides don't persist, defaults keep working */
	}
}

/** The live key map: defaults with user overrides applied. */
export function effectiveKeymap(): Map<string, KeyAction> {
	const overrides = loadOverrides();
	const map = new Map<string, KeyAction>();
	for (const def of KEYBOARD_ACTIONS) {
		if (def.displayOnly) continue; // surface-owned, never dispatched
		const binding = overrides[def.id] ?? def.binding;
		if (typeof binding === "string" && binding) map.set(binding, def.id);
	}
	return map;
}

/** Which action a normalized binding fires, if any (override-aware). */
export function actionForBinding(binding: string): KeyAction | undefined {
	return effectiveKeymap().get(binding);
}

/** The effective (override-aware) binding for one action — display use. */
export function bindingForAction(id: KeyAction): string {
	const overrides = loadOverrides();
	const def = KEYBOARD_ACTIONS.find((a) => a.id === id);
	if (!def) return "";
	return overrides[id] ?? def.binding;
}

/**
 * Normalize a KeyboardEvent to a canonical binding string. Rules:
 * - mod matches BOTH meta (⌘) and ctrl — Ctrl+K works on a Mac keyboard too.
 * - a printable key ("?") bakes its shift in: "shift+/?" collapses to "?".
 */
export function eventBinding(e: KeyboardEvent): string {
	const mod = e.metaKey || e.ctrlKey;
	// A bare printable key bakes its shift into the character ("?" not
	// "shift+/"), so it returns alone. With a real modifier riding along,
	// shift is explicit (⌘⇧F = "mod+shift+f"); non-printable keys (Tab,
	// arrows) always keep their shift (Shift+Tab = "shift+tab").
	// A shifted letter stays distinct from the plain one ("G" vs "g") — vim-style
	// bindings need it. CapsLock does not count: only the Shift key itself.
	if (e.key.length === 1 && !mod && !e.altKey) {
		return e.shiftKey && /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : e.key.toLowerCase();
	}
	const mods: string[] = [];
	if (mod) mods.push("mod");
	if (e.altKey) mods.push("alt");
	if (e.shiftKey) mods.push("shift");
	return [...mods, e.key.toLowerCase()].join("+");
}

/** Longest pause between the steps of a key sequence ("g" … "g"). */
export const SEQUENCE_TIMEOUT_MS = 1000;

/** The steps typed so far toward a sequence, and when the last one landed. */
export interface SequenceState {
	keys: string[];
	at: number;
}

export interface SequenceStep {
	/** The sequence action this key completed, if any. */
	action: KeyAction | null;
	/** Where the sequence stands now; null = nothing pending. */
	state: SequenceState | null;
}

/**
 * Feed one bare-key binding to the sequence matcher (pure). A key that
 * completes a registered sequence ("g g") returns its action; one that is
 * only a prefix keeps waiting (state); anything else resets — and a broken
 * sequence restarts from the key that broke it, so "g x g g" still fires.
 * Single-key bindings are not handled here: the caller dispatches those the
 * ordinary way when this returns neither an action nor a pending state.
 */
export function advanceSequence(
	state: SequenceState | null,
	binding: string,
	now: number,
	keymap: ReadonlyMap<string, KeyAction> = effectiveKeymap(),
): SequenceStep {
	const keys = state && now - state.at <= SEQUENCE_TIMEOUT_MS ? [...state.keys, binding] : [binding];
	const typed = keys.join(" ");
	const completed = keymap.get(typed);
	if (completed && keys.length > 1) return { action: completed, state: null };
	for (const candidate of keymap.keys()) {
		if (candidate.startsWith(`${typed} `)) return { action: null, state: { keys, at: now } };
	}
	if (keys.length > 1) return advanceSequence(null, binding, now, keymap);
	return { action: null, state: null };
}

/** The window event name a registry action dispatches/answers on —
 *  the ONE spelling shared by the dispatcher (keyboard-shortcuts) and
 *  every surface listener. Born from the ⌘B bug (owner interlude
 *  2026-09-25): the sidebar listened on the pre-convention name
 *  "lh:toggle-sidebar" while the dispatcher sent "lh:kbd-toggle-sidebar",
 *  so ⌘B silently did nothing. With both sides composing through this
 *  helper the mismatch is structurally impossible.
 */
export function kbdEventForAction(action: KeyAction): string {
	return `lh:kbd-${action}`;
}

/** True when the event lands in a typing surface (input, textarea, or a
 *  contentEditable). In one, only mod/alt combos (and Tab, which types
 *  nothing) may fire — bare keys belong to the field (typing, caret). */
export function isTypingSurface(e: KeyboardEvent): boolean {
	const target = e.target as HTMLElement | null;
	if (!target) return false;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	return target.isContentEditable;
}

/** macOS styling for binding display ("⌘D", "⇧⇥", "⌥↑"). */
export const IS_MAC =
	typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

const MOD_GLYPH = IS_MAC ? "⌘" : "Ctrl+";
const ALT_GLYPH = IS_MAC ? "⌥" : "Alt+";
const SHIFT_GLYPH = IS_MAC ? "⇧" : "Shift+";

const KEY_GLYPH: Record<string, string> = {
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
	enter: "↵",
	tab: "⇥",
	escape: "Esc",
	space: "Space",
};

/** Format a binding for display: "mod+shift+f" → "⌘⇧F", "g g" → "gg". A
 *  bare letter shows as typed ("G" is not "g"). */
export function formatBinding(binding: string): string {
	if (binding.includes(" ")) return binding.split(" ").map(formatBinding).join("");
	const parts = binding.split("+");
	const key = parts.pop()!; // last part is always the key
	const glyphs: string[] = [];
	for (const part of parts) {
		if (part === "mod") glyphs.push(MOD_GLYPH);
		else if (part === "alt") glyphs.push(ALT_GLYPH);
		else if (part === "shift") glyphs.push(SHIFT_GLYPH);
	}
	const bareLetter = glyphs.length === 0 && /^[a-z]$/i.test(key);
	const keyGlyph = KEY_GLYPH[key] ?? (bareLetter ? key : key.toUpperCase());
	return glyphs.join("") + keyGlyph;
}
