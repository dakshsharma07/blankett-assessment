// Twilio requests TwiML here at the start of the call and after every client utterance.
// Twilio cancels a webhook after a few seconds, and a model turn can take longer, so no request here
// ever waits long on the model: a turn is started in the background and Twilio is handed a silent
// two-second wait that posts back to `?wait=1`, which delivers the reply as soon as it is ready.
import { getSession, type PhoneSession } from "@/lib/phone/sessions";
import { ACKNOWLEDGMENTS, startTurn } from "@/lib/phone/turn";
import { publicBaseUrl, twimlResponse, twimlSpeakAndGather, twimlSpeakAndHangup, twimlWaitAndPostBack } from "@/lib/phone/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How long a post-back may block waiting for the model. Twilio has been seen cancelling fetches
 *  after ~5 s on this account, so every response goes out well inside that. */
const WAIT_BUDGET_MS = 3000;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const sid = url.searchParams.get("s") ?? "";
  const waiting = url.searchParams.get("wait") === "1";
  const s = getSession(sid);
  if (!s) return twimlResponse(twimlSpeakAndHangup("Sorry, this call session has expired. Goodbye."));

  const form = await req.formData().catch(() => null);
  const speech = (form?.get("SpeechResult") as string | null)?.trim() ?? "";
  const callSid = form?.get("CallSid") as string | null;
  if (callSid && !s.callSid) s.callSid = callSid;
  if (s.status === "queued" || s.status === "ringing") s.status = "in-progress";
  // Absolute URLs throughout: Twilio never has to resolve a relative path.
  const base = publicBaseUrl(req) ?? "";
  const actionUrl = `${base}/api/phone/twiml?s=${s.id}`;

  if (waiting || s.pending) return deliver(s, actionUrl);
  if (s.agentEnded) return twimlResponse(twimlSpeakAndHangup("Thank you again. Goodbye."));

  if (!s.transcript.some((t) => t.role === "agent")) {
    startTurn(s, null); // opening turn (normally already started when the call was placed)
  } else if (speech) {
    s.unansweredPrompts = 0;
    startTurn(s, speech);
    // Acknowledge immediately (in the agent's own voice when the clip is ready); the reply is collected by the post-back.
    const i = s.transcript.length % ACKNOWLEDGMENTS.length;
    const ackUrl = s.audio.has(`ack${i}`) ? `${actionUrl.replace("/twiml?", "/audio?")}&c=ack${i}` : undefined;
    return twimlResponse(twimlWaitAndPostBack(`${actionUrl}&wait=1`, ACKNOWLEDGMENTS[i], ackUrl));
  } else {
    // Silence or no speech recognised.
    s.unansweredPrompts += 1;
    if (s.unansweredPrompts >= 3) {
      s.agentEnded = true;
      s.transcript.push({ id: `t_${Date.now()}`, role: "system", text: "No response from the client; call ended.", ts: new Date().toISOString() });
      return twimlResponse(twimlSpeakAndHangup("I wasn't able to hear you. We'll follow up by email. Goodbye."));
    }
    const last = [...s.transcript].reverse().find((t) => t.role === "agent");
    return twimlResponse(twimlSpeakAndGather(s.unansweredPrompts === 1 ? "Are you still there?" : `Sorry, I didn't catch that. ${last?.text ?? "Could you repeat that?"}`, actionUrl));
  }
  return deliver(s, actionUrl);
}

/** Hand Twilio the pending reply if it is ready within the budget, otherwise a short pause and another poll. */
async function deliver(s: PhoneSession, actionUrl: string): Promise<Response> {
  const pending = s.pending;
  if (!pending) return twimlResponse(twimlSpeakAndGather("Sorry, could you say that again?", actionUrl));
  const reply = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), WAIT_BUDGET_MS))]);
  if (!reply) return twimlResponse(twimlWaitAndPostBack(`${actionUrl}&wait=1`));
  s.pending = undefined;
  const audioUrl = reply.clip ? `${actionUrl.replace("/twiml?", "/audio?")}&c=${reply.clip}` : undefined;
  if (reply.res.endCall) return twimlResponse(twimlSpeakAndHangup(reply.res.speech, audioUrl));
  return twimlResponse(twimlSpeakAndGather(reply.res.speech, actionUrl, audioUrl));
}
