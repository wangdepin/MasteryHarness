/**
 * Paused model sources — the settings record's `pausedProviders` list
 * (core/provider-pause.ts). Read fresh per call, like claudeCodeEnabled():
 * a switch flipped between two requests lands on the next admission, and
 * work already running keeps its engine.
 */
import { CURRENT_SETTINGS_VERSION, type UserSettings } from "../core/settings.ts";
import { readSettings, writeSettings } from "../store/settings.ts";

/** Every paused provider id, read from the record now. */
export function pausedProviders(): ReadonlySet<string> {
	return new Set(readSettings()?.pausedProviders ?? []);
}

/** Is this provider switched off in Settings → Providers? */
export function providerPaused(provider: string): boolean {
	return pausedProviders().has(provider);
}

/** Pause or resume ONE provider (read-modify-write of the record, so two
 *  switches flipped in a row never overwrite each other). Returns the list
 *  now stored. An empty list leaves the key out of the record. */
export function setProviderPaused(provider: string, paused: boolean): string[] {
	const record: UserSettings = readSettings() ?? { version: CURRENT_SETTINGS_VERSION };
	const ids = new Set(record.pausedProviders ?? []);
	if (paused) ids.add(provider);
	else ids.delete(provider);
	const next: UserSettings = { ...record, pausedProviders: [...ids] };
	if (ids.size === 0) delete next.pausedProviders;
	return writeSettings(next).pausedProviders ?? [];
}
