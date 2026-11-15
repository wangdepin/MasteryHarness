/**
 * The system share sheet for a file (Save to Files, AirDrop, another app):
 * what "download" means on a phone. The idea is Banner7/learnharness-server's
 * shareOrDownload.
 */

/** The part of `navigator` this needs. */
export interface ShareSurface {
	canShare?: (data: { files: File[] }) => boolean;
	share?: (data: { files: File[]; title?: string }) => Promise<void>;
}

export function canShareFile(file: File, surface: ShareSurface): boolean {
	return typeof surface.share === "function" && surface.canShare?.({ files: [file] }) === true;
}

/**
 * True when the sheet took the file, or the person closed it: either way
 * there is nothing more to do. False when this device cannot share the
 * file, or refused to; the caller downloads it instead.
 */
export async function shareFile(file: File, surface: ShareSurface): Promise<boolean> {
	if (!canShareFile(file, surface)) return false;
	try {
		await surface.share!({ files: [file], title: file.name });
		return true;
	} catch (error) {
		return (error as { name?: string } | null)?.name === "AbortError";
	}
}
