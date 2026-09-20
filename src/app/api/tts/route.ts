import { elevenLabsEnabled, synthesize } from "@/lib/ai/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!elevenLabsEnabled()) return Response.json({ error: "Natural voice is not configured" }, { status: 503 });
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return Response.json({ error: "No text" }, { status: 400 });
  try {
    const audio = await synthesize(text.slice(0, 4000));
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
