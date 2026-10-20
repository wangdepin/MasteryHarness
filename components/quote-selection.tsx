"use client";

/**
 * The floating Quote button (owner, 2026-10-21): selecting the teacher's
 * prose pops a small button beside the selection; clicking it hands the
 * selected text to `onQuote`. Mounted only while the "Thinking while
 * reading" field is. Renders nothing until there is a selection to quote.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QuoteIcon } from "lucide-react";
import { selectedPassageText } from "./quote-selection-dom";

interface Offer {
	text: string;
	x: number;
	y: number;
}

const BUTTON_W = 76;
const BUTTON_H = 28;
const GAP = 6;
/** The page's top bar (h-15 = 60px + border) — the button never sits under it. */
const TOP_BAR = 76;

function offerFor(selection: Selection): Offer | null {
	const text = selectedPassageText(selection);
	if (text === null) return null;
	const rect = selection.getRangeAt(selection.rangeCount - 1).getBoundingClientRect();
	const x = Math.min(Math.max(rect.right - BUTTON_W, 8), window.innerWidth - BUTTON_W - 8);
	// Above the selection; below it when that would run under the top bar.
	const y = rect.top - BUTTON_H - GAP >= TOP_BAR ? rect.top - BUTTON_H - GAP : rect.bottom + GAP;
	return { text, x, y };
}

export function QuoteSelection({ onQuote }: { onQuote: (text: string) => void }) {
	const [offer, setOffer] = useState<Offer | null>(null);

	useEffect(() => {
		const refresh = () => {
			const selection = window.getSelection();
			setOffer(selection ? offerFor(selection) : null);
		};
		// Offer after the gesture ends (not on every drag step); drop it the
		// moment the selection collapses or the page scrolls out from under it.
		const onSelectionChange = () => {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed) setOffer(null);
		};
		document.addEventListener("mouseup", refresh);
		document.addEventListener("keyup", refresh);
		document.addEventListener("selectionchange", onSelectionChange);
		const onScroll = () => setOffer(null);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("mouseup", refresh);
			document.removeEventListener("keyup", refresh);
			document.removeEventListener("selectionchange", onSelectionChange);
			document.removeEventListener("scroll", onScroll, true);
		};
	}, []);

	if (offer === null) return null;
	// Portaled to <body>: the dock and header are their own stacking contexts,
	// and a fixed child of the dock would paint under the top bar.
	return createPortal(
		<button
			type="button"
			data-testid="quote-selection"
			// Keep the selection (and focus) alive through the press.
			onMouseDown={(e) => e.preventDefault()}
			onClick={() => {
				onQuote(offer.text);
				window.getSelection()?.removeAllRanges();
				setOffer(null);
			}}
			style={{ position: "fixed", left: offer.x, top: offer.y, width: BUTTON_W, height: BUTTON_H }}
			className="z-[100] flex items-center justify-center gap-1 rounded-lg border bg-card text-xs text-foreground shadow-lg transition-colors hover:bg-accent"
		>
			<QuoteIcon className="size-3" />
			Quote
		</button>,
		document.body,
	);
}
