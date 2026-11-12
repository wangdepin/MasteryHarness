/**
 * Photos are normalised before a model sees them (M17): EXIF orientation applied, the long edge capped, a byte cap kept.
 * The EXIF case builds a real JPEG with an orientation tag, the way a phone camera writes one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadPhoton } from "../src/agent/image-processing/photon.mjs";
import { normalizePhoto, PHOTO_MAX_EDGE } from "../src/agent/image-processing/normalize.ts";

const photon = await loadPhoton();
assert.ok(photon, "photon (the image library) loads");

/** A solid image of w x h: red on the left half, blue on the right, so a rotation is visible in the pixels. */
function image(w: number, h: number) {
	const data = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const left = x < w / 2;
			data[i] = left ? 255 : 0;
			data[i + 1] = 0;
			data[i + 2] = left ? 0 : 255;
			data[i + 3] = 255;
		}
	}
	return new photon!.PhotonImage(data, w, h);
}

/** Insert an APP1 EXIF segment carrying `orientation` right after the JPEG's start-of-image marker. */
function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
	const tiff = [
		0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian, first IFD at 8
		0x00, 0x01, // one entry
		0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // tag 0x0112, SHORT, count 1, value
		0x00, 0x00, 0x00, 0x00, // no next IFD
	];
	const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + the TIFF block
	const length = body.length + 2;
	const segment = [0xff, 0xe1, (length >> 8) & 255, length & 255, ...body];
	return new Uint8Array([...jpeg.slice(0, 2), ...segment, ...jpeg.slice(2)]);
}

const dims = (bytes: Uint8Array) => {
	const img = photon!.PhotonImage.new_from_byteslice(bytes);
	try {
		return { w: img.get_width(), h: img.get_height() };
	} finally {
		img.free();
	}
};

describe("normalizePhoto", () => {
	it("applies the EXIF orientation: a 40x20 photo tagged 'rotate 90' comes out 20x40", async () => {
		const jpeg = image(40, 20).get_bytes_jpeg(90);
		const tagged = withOrientation(jpeg, 6);
		const out = await normalizePhoto(tagged);
		assert.ok(out);
		assert.deepEqual({ w: out.width, h: out.height }, { w: 20, h: 40 }, "upright, not sideways");
		assert.deepEqual(dims(out.bytes), { w: 20, h: 40 }, "the bytes agree with the reported size");
	});

	it("leaves an untagged photo's orientation alone", async () => {
		const out = await normalizePhoto(image(40, 20).get_bytes_jpeg(90));
		assert.ok(out);
		assert.deepEqual({ w: out.width, h: out.height }, { w: 40, h: 20 });
	});

	it("caps the long edge at 2000 px, keeping the proportions", async () => {
		const out = await normalizePhoto(image(3000, 1500).get_bytes());
		assert.ok(out);
		assert.equal(Math.max(out.width, out.height), PHOTO_MAX_EDGE);
		assert.equal(out.width, 2000);
		assert.equal(out.height, 1000);
		assert.equal(out.originalWidth, 3000);
	});

	it("does not enlarge a small photo", async () => {
		const out = await normalizePhoto(image(64, 48).get_bytes());
		assert.ok(out);
		assert.deepEqual({ w: out.width, h: out.height }, { w: 64, h: 48 });
	});

	it("reports PNG or JPEG, and the bytes are really that format", async () => {
		const out = await normalizePhoto(image(300, 200).get_bytes());
		assert.ok(out);
		const magic = [...out.bytes.slice(0, 3)];
		if (out.mimeType === "image/png") assert.deepEqual(magic.slice(0, 1), [0x89]);
		else assert.deepEqual(magic, [0xff, 0xd8, 0xff]);
	});

	it("refuses bytes that are not an image", async () => {
		assert.equal(await normalizePhoto(new TextEncoder().encode("this is not a picture")), null);
		assert.equal(await normalizePhoto(new Uint8Array(0)), null);
	});
});
