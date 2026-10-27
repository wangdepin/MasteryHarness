// Regenerate the raster icon set from the flat design source
// (build/icon-flat.svg — the M mark on a rounded squircle with baked
// transparency, owner ruling 2026-10-13; the mark itself was redrawn as
// vector from the owner's PNG in 2026-10).
//
//   build/icon.ico   Windows (.ico with 16/24/32/48/64/128/256 PNG entries)
//   build/icon.png   Linux (512x512; AppImage/deb/desktop entry)
//   build/icon.icns  macOS pre-Tahoe fallback (all 10 entries, 16->1024,
//                    packed with iconutil; macOS only — elsewhere the
//                    committed file is left alone)
//
// The macOS 26 layered icon is NOT from here: build/icon.icon (the Icon
// Composer document, layers in build/icon.icon/Assets) is compiled by actool
// at package time into Assets.car, and scripts/after-pack.cjs swaps the
// fallback icns actool writes (capped at 256px) for build/icon.icns.
//
// Renders each size DIRECTLY from the SVG (resvg) — sharper squircle
// edges than downsampling a raster. Committed outputs; rerun only when
// the design changes: `node scripts/make-icons.mjs`.
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(path.join(root, "build", "icon-flat.svg"), "utf8");

const render = (size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render(size, size).asPng();

// ---- build/icon.ico: ICONDIR + PNG entries ------------------------------
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const pngs = ICO_SIZES.map(render);
// Header (6) + one 16-byte directory entry per image, then the PNGs.
const header = Buffer.alloc(6 + ICO_SIZES.length * 16);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(ICO_SIZES.length, 4);
let offset = header.length;
ICO_SIZES.forEach((size, i) => {
	const e = 6 + i * 16;
	header.writeUInt8(size === 256 ? 0 : size, e); // 0 encodes 256
	header.writeUInt8(size === 256 ? 0 : size, e + 1);
	header.writeUInt8(0, e + 2); // colors
	header.writeUInt8(0, e + 3); // reserved
	header.writeUInt16LE(1, e + 4); // planes
	header.writeUInt16LE(32, e + 6); // bpp
	header.writeUInt32LE(pngs[i].length, e + 8);
	header.writeUInt32LE(offset, e + 12);
	offset += pngs[i].length;
});
const ico = Buffer.concat([header, ...pngs]);
writeFileSync(path.join(root, "build", "icon.ico"), ico);
console.log(`build/icon.ico  ${ICO_SIZES.join("/")} — ${(ico.length / 1024).toFixed(1)} KB`);

// ---- build/icon.png: the Linux icon -------------------------------------
const png512 = render(512);
writeFileSync(path.join(root, "build", "icon.png"), png512);
console.log(`build/icon.png  512×512 — ${(png512.length / 1024).toFixed(1)} KB`);

// ---- build/icon.icns: the macOS fallback --------------------------------
if (process.platform === "darwin") {
	const dir = mkdtempSync(path.join(os.tmpdir(), "lh-iconset-"));
	const iconset = path.join(dir, "icon.iconset");
	mkdirSync(iconset);
	// iconutil's ten entries: each point size at 1x and 2x.
	for (const point of [16, 32, 128, 256, 512]) {
		writeFileSync(path.join(iconset, `icon_${point}x${point}.png`), render(point));
		writeFileSync(path.join(iconset, `icon_${point}x${point}@2x.png`), render(point * 2));
	}
	execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(root, "build", "icon.icns")]);
	rmSync(dir, { recursive: true, force: true });
	console.log("build/icon.icns  16->1024 (10 entries)");
} else {
	console.log("build/icon.icns  skipped (iconutil is macOS only)");
}
