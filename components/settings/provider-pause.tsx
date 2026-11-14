"use client";

/**
 * The pause switch beside each connected model source in Settings →
 * Providers (owner, 2026-11-13). Off keeps the credentials but takes the
 * source's models out of every picker; On brings them straight back. The
 * paused state is the model catalog's `providers[].paused`, so every row and
 * picker reads one truth and re-reads it on the "keys" signal.
 */

import { useState } from "react";
import type { CatalogProvider } from "@/src/core";
import { useModelCatalog } from "@/components/model-catalog";
import { notifySettingsSaved } from "@/components/settings-signal";
import { Toggle } from "./controls.tsx";

/** Pure: a row is paused when every provider id it stands for is paused
 *  (one key can serve several providers, e.g. Moonshot's two regions). */
export function rowPaused(providers: readonly CatalogProvider[] | undefined, ids: readonly string[]): boolean {
	return ids.length > 0 && ids.every((id) => providers?.some((p) => p.id === id && p.paused) ?? false);
}

/** Is this row's source paused right now? */
export function useRowPaused(ids: readonly string[]): boolean {
	return rowPaused(useModelCatalog().catalog?.providers, ids);
}

/** A row label, dimmed while the row's source is paused. Mount it only where
 *  rows are pausable: it subscribes to the model catalog. */
export function PausableLabel({ ids, children }: { ids: readonly string[]; children: React.ReactNode }) {
	return useRowPaused(ids) ? <span className="opacity-50">{children}</span> : <>{children}</>;
}

async function putPaused(id: string, paused: boolean): Promise<void> {
	await fetch(`/api/providers/${encodeURIComponent(id)}/paused`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ paused }),
	}).catch(() => undefined);
}

/** "Paused" marker + the On/Off switch for the provider ids one row stands for. */
export function ProviderPauseSwitch({ ids, label }: { ids: readonly string[]; label: string }) {
	const { catalog } = useModelCatalog();
	const paused = rowPaused(catalog?.providers, ids);
	const [busy, setBusy] = useState(false);

	async function setOn(on: boolean) {
		setBusy(true);
		for (const id of ids) await putPaused(id, !on);
		setBusy(false);
		notifySettingsSaved("keys");
	}

	if (ids.length === 0) return null;
	return (
		<span className="flex shrink-0 items-center gap-2">
			{paused && <span className="font-mono text-[11px] text-muted-foreground" data-testid={`paused-${ids[0]}`}>Paused</span>}
			<Toggle
				checked={!paused}
				disabled={busy || !catalog}
				onChange={(on) => void setOn(on)}
				label={`Use ${label}`}
				title={paused ? `${label} is paused: its models are hidden. Turn on to use it again.` : `Turn off to hide ${label}'s models without removing it.`}
			/>
		</span>
	);
}
