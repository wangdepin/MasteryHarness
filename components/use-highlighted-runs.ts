"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { carryRuns, highlightPython, type Run } from "@/components/code-highlight";

/**
 * The colored Runs for `source`. Always spells exactly `source`: until its
 * highlight arrives (the highlighter loads lazily and answers off the render)
 * it carries the previous colors across the edit instead of dropping to plain.
 * Server render and first paint are plain.
 */
export function useHighlightedRuns(source: string): readonly Run[] {
	const [latest, setLatest] = useState<{ source: string; runs: readonly Run[] }>({ source: "", runs: [] });
	const current = useRef(source);
	useEffect(() => {
		current.current = source;
		const hit = highlightPython(source, (runs) => {
			if (current.current === source) setLatest({ source, runs });
		});
		if (hit) setLatest({ source, runs: hit });
	}, [source]);
	return useMemo(() => (latest.source === source ? latest.runs : carryRuns(latest.runs, source)), [latest, source]);
}
