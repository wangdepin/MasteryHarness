import { shareFile, type ShareSurface } from "./share-file";

const FALLBACK_NAME = "session.md";

export function markdownUrl(chatId: string): string {
	return `/api/chats/${encodeURIComponent(chatId)}/markdown`;
}

/** The name the export route gives the file (Content-Disposition: attachment; filename="…"). */
export function attachmentName(disposition: string | null): string {
	return /filename="([^"]+)"/.exec(disposition ?? "")?.[1] ?? FALLBACK_NAME;
}

/** A same-origin anchor download; the route's Content-Disposition names the file. */
function download(url: string): void {
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = "";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
}

export interface ExportDevice {
	/** A phone or tablet: a touch screen is the primary pointer. */
	touch: boolean;
	share: ShareSurface;
	fetch: typeof fetch;
	download: (url: string) => void;
}

function thisDevice(): ExportDevice {
	return { touch: window.matchMedia?.("(pointer: coarse)").matches === true, share: navigator, fetch: (input, init) => fetch(input, init), download };
}

async function markdownFile(url: string, device: ExportDevice): Promise<File | null> {
	try {
		const response = await device.fetch(url);
		if (!response.ok) return null;
		return new File([await response.blob()], attachmentName(response.headers.get("content-disposition")), { type: "text/markdown" });
	} catch {
		return null;
	}
}

/**
 * Export a session as Markdown: the system share sheet on a touch device
 * that can share files, a plain download everywhere else and whenever
 * sharing is not possible.
 */
export async function exportSessionMarkdown(chatId: string, device: ExportDevice = thisDevice()): Promise<void> {
	const url = markdownUrl(chatId);
	if (!device.touch || typeof device.share.share !== "function") return device.download(url);
	const file = await markdownFile(url, device);
	if (!file || !(await shareFile(file, device.share))) device.download(url);
}
