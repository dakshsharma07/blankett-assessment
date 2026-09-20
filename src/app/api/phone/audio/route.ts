// Serves a synthesised agent line to Twilio for <Play>.
import { getSession } from "@/lib/phone/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const s = getSession(url.searchParams.get("s") ?? "");
  const clip = s?.audio.get(url.searchParams.get("c") ?? "");
  if (!clip) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(clip), { headers: { "content-type": "audio/mpeg", "content-length": String(clip.byteLength), "cache-control": "no-store" } });
}
