import { getSession, touch } from "@/lib/phone/sessions";
import { hangupCall } from "@/lib/phone/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { sessionId } = (await req.json()) as { sessionId: string };
  const s = getSession(sessionId);
  if (!s) return Response.json({ error: "Unknown session" }, { status: 404 });
  try {
    if (s.callSid) await hangupCall(s.callSid);
    s.status = "completed";
    s.transcript.push({ id: `t_${Date.now()}`, role: "system", text: "Call ended by case manager.", ts: new Date().toISOString() });
    touch(s);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
