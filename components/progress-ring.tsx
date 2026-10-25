import { cn } from "@/lib/utils";
import type { PlanProgress } from "@/src/core";

/**
 * A session's plan progress as a small ring (owner, 2026-10-25): a grey
 * track and a dark arc for the share of the plan learned, so a glance down
 * the session list shows what is under way and what is finished. A finished
 * plan keeps the full ring and gains a check. Monochrome, like the rest of
 * the picker. Pure of its props — SSR-pinned in render-sidebar.test.tsx.
 */

const RADIUS = 8;
const STROKE = 2.5;
/** The arc is measured against a path of length 100, so its dash is a percentage. */
const FULL = 100;

export function ProgressRing({ done, total, className }: PlanProgress & { className?: string }) {
	const complete = total > 0 && done >= total;
	const share = total > 0 ? Math.min(done, total) / total : 0;
	const label = complete ? `All ${total} steps learned` : `${done} of ${total} steps learned`;
	return (
		<svg
			role="img"
			aria-label={label}
			data-testid="progress-ring"
			data-complete={complete ? "true" : "false"}
			viewBox="0 0 20 20"
			className={cn("size-4 shrink-0 text-foreground/70", className)}
		>
			<title>{label}</title>
			<circle cx="10" cy="10" r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-muted-foreground/25" />
			<circle
				cx="10"
				cy="10"
				r={RADIUS}
				fill="none"
				strokeWidth={STROKE}
				strokeLinecap={complete || share === 0 ? "butt" : "round"}
				pathLength={FULL}
				strokeDasharray={`${Math.round(share * FULL)} ${FULL}`}
				transform="rotate(-90 10 10)"
				className="stroke-current"
			/>
			{complete && (
				<path
					data-testid="progress-check"
					d="M6.5 10.2l2.5 2.5 4.6-5"
					fill="none"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="stroke-current"
				/>
			)}
		</svg>
	);
}
