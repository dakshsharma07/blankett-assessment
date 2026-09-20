// One conversational turn for a phone session: the same engine as the browser call, but the line is
// released to Twilio as soon as the model has composed it; the record updates finish in the background.

import { isLive } from "@/lib/ai/client";
import { liveConverseStreaming } from "@/lib/ai/converse";
import { demoConverse } from "@/lib/demo/agent";
import { elevenLabsEnabled, synthesize } from "@/lib/ai/elevenlabs";
import type { ConverseResponse } from "@/lib/types";
import { touch, type PhoneReply, type PhoneSession } from "@/lib/phone/sessions";

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Start generating the agent's next turn. The promise resolves once the line can be spoken and never rejects. */
export function startTurn(s: PhoneSession, clientUtterance: string | null): Promise<PhoneReply> {
  const p = phoneTurn(s, clientUtterance)
    .catch((e: unknown): ConverseResponse => {
      s.error = e instanceof Error ? e.message : String(e);
      console.error("[phone] turn failed:", s.error);
      const res: ConverseResponse = { reasoning: [], speech: "Sorry, I lost my train of thought for a second. Could you say that again?", focusIssueId: s.focusIssueId, updates: [], endCall: false, engine: isLive() ? "live" : "demo" };
      s.transcript.push({ id: id("t"), role: "agent", text: res.speech, ts: new Date().toISOString(), issueId: s.focusIssueId });
      touch(s);
      return res;
    })
    .then((res) => voice(s, res));
  s.pending = p;
  return p;
}

async function phoneTurn(s: PhoneSession, clientUtterance: string | null): Promise<ConverseResponse> {
  // The previous turn's record updates may still be streaming in; they belong in this request.
  await s.completing;
  // The utterance is passed separately, so the transcript sent to the model stops before it.
  const transcript = [...s.transcript];
  if (clientUtterance) {
    s.transcript.push({ id: id("t"), role: "client", text: clientUtterance, ts: new Date().toISOString(), issueId: s.focusIssueId });
  }
  const req = {
    caseSummary: s.context.caseSummary,
    issues: s.context.issues,
    plan: s.context.plan,
    evidenceChecklist: s.context.evidenceChecklist,
    clarifications: s.clarifications,
    transcript,
    clientUtterance,
  };

  const speak = (res: ConverseResponse) => {
    if (!res.speech.trim()) {
      // A turn with nothing to say would leave dead air on the line.
      const focus = s.context.issues.find((i) => i.id === (res.focusIssueId ?? s.focusIssueId));
      res.speech = focus ? `Thank you. ${focus.suggestedQuestion}` : "Thank you. Could you tell me a little more about that?";
    }
    s.transcript.push({ id: id("t"), role: "agent", text: res.speech, ts: new Date().toISOString(), issueId: res.focusIssueId, reasoning: res.reasoning });
    s.focusIssueId = res.focusIssueId;
    if (res.endCall) s.agentEnded = true;
    touch(s);
  };
  const record = (res: ConverseResponse) => {
    for (const u of res.updates) s.clarifications = [...s.clarifications.filter((c) => c.issueId !== u.issueId), u];
    if (res.updates.length) touch(s);
  };

  if (!isLive()) {
    const res = demoConverse(req);
    speak(res);
    record(res);
    return res;
  }

  return new Promise<ConverseResponse>((resolve, reject) => {
    let released = false;
    const full = liveConverseStreaming(req, (early) => {
      released = true;
      speak(early);
      resolve(early);
    });
    // Whether or not the speech was released early, the complete turn carries the record updates.
    s.completing = full
      .then((res) => {
        if (!released) {
          speak(res);
          resolve(res);
        }
        record(res);
      })
      .catch((e: unknown) => {
        if (!released) reject(e);
        else console.error("[phone] record updates failed after speech:", e instanceof Error ? e.message : e);
      })
      .finally(() => {
        s.completing = undefined;
      });
  });
}

/** Spoken at once when the client finishes a turn, so the line is never dead while the model works. */
export const ACKNOWLEDGMENTS = ["Okay.", "Mm-hm."];

/** Pre-synthesise the acknowledgments in the agent's voice while the phone is ringing (keyed "ack0", "ack1", …). */
export function prepareAcknowledgments(s: PhoneSession): void {
  if (!elevenLabsEnabled()) return;
  ACKNOWLEDGMENTS.forEach((text, i) => {
    void synthesize(text, { fast: true })
      .then((audio) => s.audio.set(`ack${i}`, Buffer.from(audio)))
      .catch((e) => console.warn("[phone] acknowledgment synthesis failed:", e instanceof Error ? e.message : e));
  });
}

/** Natural voice for the line when ElevenLabs is configured; Twilio's built-in voice otherwise. */
async function voice(s: PhoneSession, res: ConverseResponse): Promise<PhoneReply> {
  if (!elevenLabsEnabled()) return { res };
  try {
    const clip = id("clip");
    s.audio.set(clip, Buffer.from(await synthesize(res.speech, { fast: true })));
    // Keep memory bounded: only the last few clips are ever re-fetched.
    for (const k of [...s.audio.keys()].filter((k) => k.startsWith("clip")).slice(0, -6)) s.audio.delete(k);
    return { res, clip };
  } catch (e) {
    console.warn("[phone] voice synthesis failed; using Twilio voice:", e instanceof Error ? e.message : e);
    return { res };
  }
}
