import { getDb } from "@/db/client";
import { verifySignature, handleWebhook } from "@/github/webhook";

// Inbound GitHub webhook (REQ-009): mirrors task github_status. The only writer.
export async function POST(req: Request): Promise<Response> {
  const body = await req.text(); // raw body needed for the signature
  if (!verifySignature(process.env.GITHUB_WEBHOOK_SECRET, body, req.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const result = await handleWebhook(getDb(), req.headers.get("x-github-event"), payload);
  return Response.json(result);
}
