/**
 * THE VISIBLE HEIGHT. On a phone the on-screen keyboard covers the bottom
 * of the page without resizing it: `100dvh` still measures the whole
 * screen, and a composer pinned to the bottom ends up under the keyboard.
 * The visual viewport is the part actually in view. Two lengths come from
 * it, set on <html> and used by app/phone.css:
 *
 *   --lh-app-height       the height of the visible page
 *   --lh-keyboard-inset   how much of the page's bottom is covered
 */

export interface ViewportMetrics {
	/** window.innerHeight: the page as laid out, keyboard or not. */
	layoutHeight: number;
	/** visualViewport.height, offsetTop and scale. */
	visualHeight: number;
	visualOffsetTop: number;
	scale: number;
}

export interface ViewportVars {
	"--lh-app-height": string;
	"--lh-keyboard-inset": string;
}

const ZOOM_TOLERANCE = 0.01;

/**
 * The two lengths for these metrics, or null while the page is pinch-zoomed:
 * zooming shrinks the visual viewport too, and must not resize the app.
 */
export function viewportVars(metrics: ViewportMetrics): ViewportVars | null {
	if (Math.abs(metrics.scale - 1) > ZOOM_TOLERANCE) return null;
	const covered = metrics.layoutHeight - metrics.visualHeight - metrics.visualOffsetTop;
	return {
		"--lh-app-height": `${Math.round(metrics.visualHeight)}px`,
		"--lh-keyboard-inset": `${Math.max(0, Math.round(covered))}px`,
	};
}
