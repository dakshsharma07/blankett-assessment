import { elevenLabsEnabled, transcribe } from "@/lib/ai/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!elevenLabsEnabled()) return Response.json({ error: "Natural voice is not configured" }, { status: 503 });
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob) || file.size < 1000) return Response.json({ text: "" });
  try {
    const name = file instanceof File ? file.name : "audio.webm";
    const text = await transcribe(file, name);
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
