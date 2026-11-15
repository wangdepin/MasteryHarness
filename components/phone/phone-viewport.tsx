"use client";

import { useEffect } from "react";
import { viewportVars } from "./visual-viewport";

/** Keeps the two viewport lengths on <html> current on touch devices (see visual-viewport.ts). Renders nothing. */
export function PhoneViewport() {
	useEffect(() => {
		const visual = window.visualViewport;
		if (!visual || !window.matchMedia?.("(pointer: coarse)").matches) return;
		const apply = () => {
			const vars = viewportVars({ layoutHeight: window.innerHeight, visualHeight: visual.height, visualOffsetTop: visual.offsetTop, scale: visual.scale });
			if (!vars) return;
			for (const [name, value] of Object.entries(vars)) document.documentElement.style.setProperty(name, value);
		};
		apply();
		visual.addEventListener("resize", apply);
		visual.addEventListener("scroll", apply);
		window.addEventListener("resize", apply);
		return () => {
			visual.removeEventListener("resize", apply);
			visual.removeEventListener("scroll", apply);
			window.removeEventListener("resize", apply);
		};
	}, []);
	return null;
}
