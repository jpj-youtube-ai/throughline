import { getDb } from "@/db/client";
import { getIdeaPhoto } from "@/ideas/photos";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const photo = await getIdeaPhoto(getDb(), id);
  if (!photo) return new Response("Not found", { status: 404 });
  // nosniff: this is a public, unauthenticated route serving user-uploaded bytes
  // with a user-supplied media type — stop the browser from sniffing them as
  // anything executable (defense-in-depth behind the upload's image-type allow-list).
  return new Response(new Uint8Array(photo.image), {
    headers: {
      "Content-Type": photo.mediaType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
