import { isLive } from "@/lib/ai/client";
import { liveAnalyze } from "@/lib/ai/analyze";
import { demoAnalyze } from "@/lib/demo/analysis";
import type { CaseDocument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json()) as { documents: CaseDocument[] };
  const docs = body.documents ?? [];
  if (docs.length === 0) return Response.json({ error: "No documents to analyze" }, { status: 400 });
  try {
    const result = isLive() ? await liveAnalyze(docs) : demoAnalyze(docs);
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 500 });
  }
}
