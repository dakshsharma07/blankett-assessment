import { getSession, publicView, touch, type PhoneStatus } from "@/lib/phone/sessions";
import { getCallStatus } from "@/lib/phone/twilio";

export const dynamic = "force-dynamic";

const STATUS: Record<string, PhoneStatus> = { queued: "queued", initiated: "queued", ringing: "ringing", "in-progress": "in-progress", completed: "completed", busy: "busy", failed: "failed", "no-answer": "no-answer", canceled: "canceled" };
const POLL_EVERY_MS = 3000;
const lastPoll = new Map<string, number>();

export async function GET(req: Request) {
  const sid = new URL(req.url).searchParams.get("s") ?? "";
  const s = getSession(sid);
  if (!s) return Response.json({ error: "Unknown session" }, { status: 404 });
  // Status callbacks are unavailable on trial accounts, so refresh the call status from Twilio while the call is live.
  const live = s.status === "queued" || s.status === "ringing" || s.status === "in-progress";
  if (s.callSid && live && Date.now() - (lastPoll.get(s.id) ?? 0) > POLL_EVERY_MS) {
    lastPoll.set(s.id, Date.now());
    const status = await getCallStatus(s.callSid).catch(() => null);
    const mapped = status ? STATUS[status] : undefined;
    if (mapped && mapped !== s.status) {
      s.status = mapped;
      if (mapped === "completed" && !s.transcript.some((t) => t.role === "system")) {
        s.transcript.push({ id: `t_${Date.now()}`, role: "system", text: "Call completed.", ts: new Date().toISOString() });
      }
      touch(s);
    }
  }
  return Response.json(publicView(s));
}
