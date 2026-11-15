// Regenerate the home-screen icons of the web app from the flat design
// source (build/icon-flat.svg, the same mark the desktop icons use).
//
//   app/apple-icon.png    iOS home screen (180x180); Next links it from <head>
//   public/icon-192.png   web app manifest (app/manifest.ts)
//   public/icon-512.png   web app manifest
//
// Unlike the desktop set (scripts/make-icons.mjs), these are OPAQUE: the
// squircle's own colour fills the whole square. iOS paints transparency
// black and rounds the corners itself, so a transparent corner would show
// as a second, darker outline.
//
// Committed outputs; rerun only when the design changes:
//   node scripts/make-web-app-icons.mjs
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(path.join(root, "build", "icon-flat.svg"), "utf8");
/** The squircle's fill in build/icon-flat.svg, and the default theme's background. */
const BACKGROUND = "#141414";

const render = (size) => new Resvg(svg, { background: BACKGROUND, fitTo: { mode: "width", value: size } }).render().asPng();

for (const [file, size] of [["app/apple-icon.png", 180], ["public/icon-192.png", 192], ["public/icon-512.png", 512]]) {
	const png = render(size);
	writeFileSync(path.join(root, file), png);
	console.log(`${file}  ${size}x${size} — ${(png.length / 1024).toFixed(1)} KB`);
}
