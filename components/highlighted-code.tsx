"use client";

import type { CSSProperties } from "react";
import { useHighlightedRuns } from "@/components/use-highlighted-runs";

/**
 * Python source as colored text — the inside of a <pre>, not the <pre>
 * itself, so the editor's overlay and the answered card each keep their own
 * box. Colors follow the app theme through .lh-tok (globals.css).
 */
export function HighlightedCode({ code }: { code: string }) {
	const runs = useHighlightedRuns(code);
	return (
		<>
			{runs.map((run, index) =>
				run.light === undefined ? (
					run.text
				) : (
					<span key={index} className="lh-tok" style={{ "--tok-light": run.light, "--tok-dark": run.dark } as CSSProperties}>
						{run.text}
					</span>
				),
			)}
		</>
	);
}
