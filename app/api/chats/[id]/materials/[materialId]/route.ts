/** DELETE a lesson's source material (fork addition): its record, stored
 *  copy and any read in progress. The next turn no longer sees it. */
import { removeMaterial } from "@/src/server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; materialId: string }> }) {
	const { id, materialId } = await params;
	return removeMaterial(id, materialId)
		? Response.json({ ok: true })
		: Response.json({ error: "Unknown material" }, { status: 404 });
}
