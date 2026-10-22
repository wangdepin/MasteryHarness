"use client";

/**
 * Automatic quoting (owner, 2026-10-22): releasing the mouse on a selection of
 * the teacher's prose hands the selected text straight to `onQuote` — no
 * button to click. The selection is left in place, so Cmd+C still copies it.
 * Selections under MIN_AUTO_QUOTE_CHARS are ignored, and the same selection is
 * never quoted twice. Mounted only while a question waits. Renders nothing.
 */

import { useEffect, useRef } from "react";
import { isAutoQuotable, selectedPassageText } from "./quote-selection-dom";

export function QuoteSelection({ onQuote }: { onQuote: (text: string) => void }) {
	// The handler is read through a ref so the listeners are attached once.
	const quoteRef = useRef(onQuote);
	quoteRef.current = onQuote;
	// The text already quoted from the current selection; cleared when it collapses.
	const quoted = useRef<string | null>(null);

	useEffect(() => {
		// Quote after the gesture ends (not on every drag step).
		const onMouseUp = () => {
			const selection = window.getSelection();
			const text = selection ? selectedPassageText(selection) : null;
			if (text === null || !isAutoQuotable(text) || text === quoted.current) return;
			quoted.current = text;
			quoteRef.current(text);
		};
		const onSelectionChange = () => {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed) quoted.current = null;
		};
		document.addEventListener("mouseup", onMouseUp);
		document.addEventListener("selectionchange", onSelectionChange);
		return () => {
			document.removeEventListener("mouseup", onMouseUp);
			document.removeEventListener("selectionchange", onSelectionChange);
		};
	}, []);

	return null;
}
