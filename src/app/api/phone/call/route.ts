import { createSession } from "@/lib/phone/sessions";
import { createCall, publicBaseUrl, twilioConfigured } from "@/lib/phone/twilio";
import { prepareAcknowledgments, startTurn } from "@/lib/phone/turn";
import type { CaseSummary, EvidenceCheck, Issue, PlanStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  caseSummary: CaseSummary;
  issues: Issue[];
  plan?: PlanStep[];
  evidenceChecklist?: EvidenceCheck[];
  to?: string;
}

export async function POST(req: Request) {
  if (!twilioConfigured()) return Response.json({ error: "Phone calling is not configured (TWILIO_* variables)." }, { status: 503 });
  const base = publicBaseUrl(req);
  if (!base) {
    return Response.json(
      { error: "Twilio needs a public URL to reach this server. Start a tunnel (npm run tunnel) and open the app through that URL, or set PUBLIC_BASE_URL in .env.local." },
      { status: 400 },
    );
  }
  const body = (await req.json()) as Body;
  const to = (body.to || process.env.DEMO_CLIENT_PHONE || "").trim();
  if (!/^\+\d{8,15}$/.test(to)) return Response.json({ error: "Client phone number must be in E.164 format, e.g. +14045550123." }, { status: 400 });

  const session = createSession({
    id: `ph_${Math.random().toString(36).slice(2, 12)}`,
    to,
    status: "queued",
    context: { caseSummary: body.caseSummary, issues: body.issues, plan: body.plan ?? [], evidenceChecklist: body.evidenceChecklist ?? [] },
  });
  // Compose the greeting while the phone is still ringing so the first TwiML fetch answers instantly.
  startTurn(session, null);
  prepareAcknowledgments(session);
  try {
    const call = await createCall({
      to,
      url: `${base}/api/phone/twiml?s=${session.id}`,
      statusCallback: `${base}/api/phone/status?s=${session.id}`,
    });
    session.callSid = call.sid;
    return Response.json({ sessionId: session.id, callSid: call.sid, to });
  } catch (e) {
    session.status = "failed";
    session.error = e instanceof Error ? e.message : String(e);
    return Response.json({ error: session.error }, { status: 502 });
  }
}
