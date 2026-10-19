"use client";

/**
 * Mounts the math-aware copy listener once for the whole app (the transcript,
 * question cards, thinking blocks and practice all render KaTeX, so one
 * document-level handler covers them). Renders nothing.
 */

import { useEffect } from "react";
import { handleMathCopy } from "./math-copy-dom";

export default function MathCopy() {
	useEffect(() => {
		document.addEventListener("copy", handleMathCopy);
		return () => document.removeEventListener("copy", handleMathCopy);
	}, []);
	return null;
}
