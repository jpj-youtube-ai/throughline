import { getDb } from "@/db/client";
import { getIdeaPhoto } from "@/ideas/photos";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const photo = await getIdeaPhoto(getDb(), id);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.image), {
    headers: { "Content-Type": photo.mediaType, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
