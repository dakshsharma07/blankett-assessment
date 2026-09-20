// Minimal Twilio Programmable Voice client (REST + TwiML). No SDK needed for two endpoints.

export function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

function auth(): string {
  return "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
}

function api(path: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}${path}`;
}

export async function createCall(opts: { to: string; url: string; statusCallback: string }): Promise<{ sid: string; status: string }> {
  const full = new URLSearchParams({
    To: opts.to,
    From: process.env.TWILIO_FROM_NUMBER!,
    Url: opts.url,
    Method: "POST",
    StatusCallback: opts.statusCallback,
    StatusCallbackMethod: "POST",
    Timeout: "30",
  });
  for (const ev of ["initiated", "ringing", "answered", "completed"]) full.append("StatusCallbackEvent", ev);
  // Trial accounts reject anything beyond To/From/Url (POST is Twilio's default method, so it is not
  // sent). Try progressively smaller requests; without callbacks the app polls the call for status.
  const withCallback = new URLSearchParams({ To: opts.to, From: process.env.TWILIO_FROM_NUMBER!, Url: opts.url, StatusCallback: opts.statusCallback });
  const minimal = new URLSearchParams({ To: opts.to, From: process.env.TWILIO_FROM_NUMBER!, Url: opts.url });
  let last: { message?: string; code?: number; status: number } = { status: 0 };
  for (const body of [full, withCallback, minimal]) {
    const res = await fetch(api("/Calls.json"), { method: "POST", headers: { Authorization: auth(), "content-type": "application/x-www-form-urlencoded" }, body });
    const data = (await res.json()) as { sid?: string; status?: string; message?: string; code?: number };
    if (res.ok && data.sid) return { sid: data.sid, status: data.status ?? "queued" };
    last = { message: data.message, code: data.code, status: res.status };
    if (!/disallowed parameters|trial account/i.test(data.message ?? "")) break;
  }
  throw new Error(`Twilio call failed: ${last.message ?? last.status}${last.code ? ` (code ${last.code})` : ""}`);
}

/** Current status of a call, for accounts that cannot receive status callbacks. */
export async function getCallStatus(callSid: string): Promise<string | null> {
  const res = await fetch(api(`/Calls/${callSid}.json`), { headers: { Authorization: auth() } });
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: string };
  return data.status ?? null;
}

export async function hangupCall(callSid: string): Promise<void> {
  const body = new URLSearchParams({ Status: "completed" });
  const res = await fetch(api(`/Calls/${callSid}.json`), { method: "POST", headers: { Authorization: auth(), "content-type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`Twilio hangup failed: ${res.status}`);
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// A generative voice by default; override with TWILIO_VOICE (e.g. Polly.Ruth-Generative). ElevenLabs takes over when ELEVENLABS_API_KEY is set.
const VOICE = () => process.env.TWILIO_VOICE || "Google.en-US-Chirp3-HD-Aoede";

/** The agent's line: a synthesised clip when one exists, otherwise Twilio's own voice. */
function line(text: string, audioUrl?: string): string {
  return audioUrl ? `<Play>${escapeXml(audioUrl)}</Play>` : `<Say voice="${VOICE()}">${escapeXml(text)}</Say>`;
}

/** Speak the whole line (not interruptible), then listen for the next utterance, ending it after one second of silence. */
export function twimlSpeakAndGather(text: string, actionUrl: string, audioUrl?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${line(text, audioUrl)}
  <Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" language="en-US" speechModel="experimental_conversations" speechTimeout="1" timeout="6" actionOnEmptyResult="true"/>
</Response>`;
}

/** Wait silently for a couple of seconds, then post back (used while the model is still composing a reply).
 *  A keypad Gather that nobody answers is used rather than <Redirect>, which trial calls cap at ten per call. */
export function twimlWaitAndPostBack(url: string, acknowledgment?: string, acknowledgmentAudioUrl?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="1" actionOnEmptyResult="true" action="${escapeXml(url)}" method="POST">${acknowledgment ? line(acknowledgment, acknowledgmentAudioUrl) : ""}</Gather>
</Response>`;
}

/** Speak, then hang up. */
export function twimlSpeakAndHangup(text: string, audioUrl?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${line(text, audioUrl)}
  <Hangup/>
</Response>`;
}

export function twimlResponse(xml: string): Response {
  return new Response(xml, { headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } });
}

/** Resolve the public base URL Twilio must call back to. */
export function publicBaseUrl(req: Request): string | null {
  // The address the app is being opened at wins when it is public: quick-tunnel hostnames change on
  // every restart, so a stale PUBLIC_BASE_URL must not override a live one.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const local = !host || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(host);
  if (!local) return `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return null;
}
