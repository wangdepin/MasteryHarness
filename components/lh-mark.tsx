/**
 * LhMark — the app mark: the M graph (rings joined by bars, a white and an
 * amber end node), the same drawing as the app icon (build/icon-flat.svg).
 * Inlined as JSX so it rides along with the components (no network fetch,
 * crisp at any size). The viewBox is cropped tight around the glyph, no
 * padding: sizing/padding is the consumer's job. The M follows the text
 * colour (white on the dark theme, black on the light one); only the amber
 * node keeps its own colour.
 *
 * It is the "LH" wordmark's successor in the sidebar band (also the
 * traffic-light gutter's resident in the merged desktop chrome).
 */
export function LhMark({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="185 213 657 609" className={className} aria-hidden="true">
			<g fill="currentColor">
				<path d="M237 352H287V742H237Z"/>
				<path d="M737 352H787V742H737Z"/>
				<path d="M285.78 352.48L451.53 531.49L488.22 497.52L322.47 318.51Z"/>
				<path d="M701.53 318.51L535.78 497.52L572.47 531.49L738.22 352.48Z"/>
				<path fillRule="evenodd" d="M185 290a77 77 0 1 0 154 0a77 77 0 1 0 -154 0ZM215 290a47 47 0 1 1 94 0a47 47 0 1 1 -94 0Z"/>
				<path fillRule="evenodd" d="M685 290a77 77 0 1 0 154 0a77 77 0 1 0 -154 0ZM715 290a47 47 0 1 1 94 0a47 47 0 1 1 -94 0Z"/>
				<path fillRule="evenodd" d="M435 560a77 77 0 1 0 154 0a77 77 0 1 0 -154 0ZM465 560a47 47 0 1 1 94 0a47 47 0 1 1 -94 0Z"/>
				<circle cx="262" cy="742" r="72"/>
			</g>
			<circle cx="762" cy="742" r="80" fill="#f5b83d" />
		</svg>
	);
}
