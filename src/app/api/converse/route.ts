import { isLive } from "@/lib/ai/client";
import { liveConverse } from "@/lib/ai/converse";
import { demoConverse } from "@/lib/demo/agent";
import type { ConverseRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json()) as ConverseRequest;
  const t0 = Date.now();
  try {
    const result = isLive() ? await liveConverse(body) : demoConverse(body);
    console.log(`[converse] ${result.engine} turn ${body.transcript.length + 1} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 500 });
  }
}
