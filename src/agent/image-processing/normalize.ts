import { convertImageBytesToPng } from "./convert.mjs";
import { resizeImage } from "./resize.ts";

/**
 * A photo ready for a model and for the page store (M17, docs/android/m17-plan.md): decoded, its EXIF orientation applied (a
 * phone photo is stored sideways with a tag the model never reads), the long edge at most MAX_EDGE, and re-encoded under the
 * byte cap (PNG when that fits, JPEG otherwise). Uses the one image library the app ships (photon); null when the bytes are not
 * an image it can decode or cannot be brought under the cap.
 */

/** The long edge of a normalised photo (the sketch page limit, SKETCH_MAX_EDGE). */
export const PHOTO_MAX_EDGE = 2000;
/** The most a normalised photo may encode to (base64), well under a provider's inline image limit. */
export const PHOTO_MAX_BYTES = 4_000_000;

export interface NormalizedPhoto {
	bytes: Buffer;
	mimeType: "image/png" | "image/jpeg";
	width: number;
	height: number;
	/** The size after orientation, before the resize. */
	originalWidth: number;
	originalHeight: number;
}

export async function normalizePhoto(bytes: Uint8Array, options?: { maxEdge?: number; maxBytes?: number }): Promise<NormalizedPhoto | null> {
	const edge = options?.maxEdge ?? PHOTO_MAX_EDGE;
	// decoding to PNG applies the EXIF orientation once, so everything after it is upright
	const upright = await convertImageBytesToPng(bytes);
	if (!upright) return null;
	const resized = await resizeImage(upright, "image/png", { maxWidth: edge, maxHeight: edge, maxBytes: options?.maxBytes ?? PHOTO_MAX_BYTES });
	if (!resized) return null;
	return {
		bytes: Buffer.from(resized.data, "base64"),
		mimeType: resized.mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
		width: resized.width,
		height: resized.height,
		originalWidth: resized.originalWidth,
		originalHeight: resized.originalHeight,
	};
}
