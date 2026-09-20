// Simulates Twilio's webhooks against the TwiML handler (no real call). Uses demo mode unless LIVE=1.
import fs from "node:fs";
if (!process.env.LIVE) process.env.BLANKETT_FORCE_DEMO = "1";
const { createSession } = await import("../src/lib/phone/sessions.ts");
const { POST } = await import("../src/app/api/phone/twiml/route.ts");
const analysis = JSON.parse(fs.readFileSync("scripts/.live-analysis.json", "utf8"));
const s = createSession({ id: "ph_test", to: "+15555550100", status: "queued", context: { caseSummary: analysis.caseSummary, issues: analysis.issues, plan: analysis.resolutionPlan, evidenceChecklist: analysis.evidenceChecklist } });
async function hit(fields: Record<string, string>, q = "") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await POST(new Request(`https://demo.trycloudflare.com/api/phone/twiml?s=${s.id}${q}`, { method: "POST", body: fd }));
  const xml = await res.text();
  console.log(xml.replace(/\s+/g, " ").slice(0, 420), "\n");
}
await hit({ CallSid: "CA123", CallStatus: "in-progress" });
await hit({ CallSid: "CA123", SpeechResult: "yes I went to London for a friend's wedding, February 14 to 21" });
await hit({ CallSid: "CA123", SpeechResult: "" });
await hit({ CallSid: "CA123" }, "&noinput=1");
await hit({ CallSid: "CA123", SpeechResult: "okay thanks, bye" });
console.log("turns:", s.transcript.length, "clarifications:", s.clarifications.map((c) => c.issueId + "=" + c.status));
