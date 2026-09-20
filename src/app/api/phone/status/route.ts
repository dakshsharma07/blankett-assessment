// Twilio call status callbacks (initiated → ringing → answered → completed / failed / no-answer).
import { getSession, touch, type PhoneStatus } from "@/lib/phone/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sid = new URL(req.url).searchParams.get("s") ?? "";
  const s = getSession(sid);
  const form = await req.formData().catch(() => null);
  const status = (form?.get("CallStatus") as string | null) ?? "";
  if (s && status) {
    const map: Record<string, PhoneStatus> = { queued: "queued", initiated: "queued", ringing: "ringing", "in-progress": "in-progress", answered: "in-progress", completed: "completed", busy: "busy", failed: "failed", "no-answer": "no-answer", canceled: "canceled" };
    s.status = map[status] ?? s.status;
    if (s.status === "completed" && !s.transcript.some((t) => t.role === "system")) {
      s.transcript.push({ id: `t_${Date.now()}`, role: "system", text: "Call completed.", ts: new Date().toISOString() });
    }
    touch(s);
  }
  return new Response(null, { status: 204 });
}
