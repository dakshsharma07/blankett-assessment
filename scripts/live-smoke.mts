// Live smoke test: parse the sample docs → liveAnalyze → a scripted liveConverse call → livePackage.
// Run with: set -a; source .env.local; set +a; npx tsx scripts/live-smoke.mts [analyze|call|package|all]
import fs from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { liveAnalyze } from "../src/lib/ai/analyze.ts";
import { liveConverse } from "../src/lib/ai/converse.ts";
import { livePackage } from "../src/lib/ai/package.ts";
import type { AnalysisResult, CaseDocument, Clarification, TranscriptTurn } from "../src/lib/types.ts";

const mode = process.argv[2] ?? "all";
const cache = path.resolve("scripts/.live-analysis.json");

async function load(): Promise<CaseDocument[]> {
  const dir = path.resolve("demo-documents");
  const docs: CaseDocument[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => /\.(pdf|docx)$/i.test(f))) {
    const buf = fs.readFileSync(path.join(dir, f));
    let text = f.endsWith(".pdf") ? (await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })).text : (await mammoth.extractRawText({ buffer: buf })).value;
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
    docs.push({ id: "d_" + f.slice(0, 6), name: f, kind: f.endsWith(".pdf") ? "pdf" : "docx", size: buf.length, text, uploadedAt: "" });
  }
  return docs;
}

const docs = await load();
let analysis: AnalysisResult;
if (mode === "analyze" || mode === "all" || !fs.existsSync(cache)) {
  const t0 = Date.now();
  analysis = await liveAnalyze(docs);
  console.log(`ANALYSIS in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  fs.writeFileSync(cache, JSON.stringify(analysis, null, 2));
} else {
  analysis = JSON.parse(fs.readFileSync(cache, "utf8"));
}
console.log("CASE:", analysis.caseSummary);
console.log("CHECKLIST:"); for (const e of analysis.evidenceChecklist ?? []) console.log(` [${e.status}] ${e.item}${e.foundIn ? " ← " + e.foundIn : ""}${e.askClient ? " (ask: " + e.question.slice(0, 80) + "…)" : ""}`);
console.log("FOLLOW-UPS:"); for (const p of analysis.resolutionPlan ?? []) for (const q of p.followUps ?? []) console.log(` - [${p.issueId}] ${q}`);
console.log("FACTS:", analysis.facts.length, "unverified:", analysis.facts.filter((f) => !f.evidence.verified).map((f) => `${f.label} <- ${f.evidence.docName}: ${f.evidence.quote}`));
for (const i of analysis.issues) {
  console.log(`\n## ${i.id} [${i.kind}/${i.severity}] contact=${i.requiresClientContact}\n  ${i.title}\n  summary: ${i.summary}\n  why: ${i.whyFlagged}\n  explanation: ${i.possibleExplanation ?? "-"}\n  need: ${i.needToKnow}\n  Q: ${i.suggestedQuestion}`);
  for (const e of i.evidence) console.log(`   ${e.verified ? "✓" : "✗"} ${e.docName} | ${e.section} | "${e.quote}"`);
}
if (mode === "analyze") process.exit(0);

const script = [
  "Hi, yes this is Maya.",
  "No, I don't think I went to the UK",
  "Oh wait, actually yes, I went to London for my friend's wedding, I totally forgot. Nothing else though.",
  "Yes, February 21st, that's right",
  "I was staying with my cousin at 415 Ponce de Leon Avenue, apartment 9, in Atlanta, from when I got back on January 8th through the end of April",
  "I don't know the ZIP off the top of my head",
  "Hmm, I told my school's international office I moved, I think they updated it, but I'm not 100% sure",
  "Right, I was doing contract work for them starting mid January, and then they made me full time on March 1st",
  "They paid me by bank transfer, I have the agreement somewhere and I think two invoices",
  "Between Cobalt and Northstar I was in India with family, not working",
  "I have the I-20 and the EAD card, yes",
  "I have my master's diploma here but the B.Tech certificate is with my parents in India",
  "The I-797, I think HR has it, I only got a copy of the receipt",
  "Okay, thanks, bye",
];


const transcript: TranscriptTurn[] = [];
let clar: Clarification[] = [];
let t0 = Date.now();
let res = await liveConverse({ caseSummary: analysis.caseSummary, issues: analysis.issues, plan: analysis.resolutionPlan, evidenceChecklist: analysis.evidenceChecklist, clarifications: clar, transcript, clientUtterance: null });
console.log(`\nAGENT (${((Date.now() - t0) / 1000).toFixed(1)}s):`, res.speech);
transcript.push({ id: "t0", role: "agent", text: res.speech, ts: "" });
for (const line of script) {
  if (res.endCall) break;
  console.log("CLIENT:", line);
  t0 = Date.now();
  const reqBody = { caseSummary: analysis.caseSummary, issues: analysis.issues, plan: analysis.resolutionPlan, evidenceChecklist: analysis.evidenceChecklist, clarifications: clar, transcript, clientUtterance: line };
  fs.writeFileSync("scripts/.live-last-request.json", JSON.stringify(reqBody, null, 2));
  res = await liveConverse(reqBody);
  transcript.push({ id: "c", role: "client", text: line, ts: "" }, { id: "a", role: "agent", text: res.speech, ts: "" });
  for (const u of res.updates) clar = [...clar.filter((c) => c.issueId !== u.issueId), u];
  console.log(`AGENT (${((Date.now() - t0) / 1000).toFixed(1)}s) [focus=${res.focusIssueId} end=${res.endCall}]:`, res.speech);
  for (const u of res.updates) console.log(`   -> ${u.issueId}=${u.status} | ${u.clientStatement} | ${JSON.stringify(u.findings)} | ${u.proposedResolution}${u.notes ? " | notes: " + u.notes : ""}`);
}
console.log("\nEND CALL:", res.endCall);
if (mode === "call") process.exit(0);

t0 = Date.now();
const pkg = await livePackage({ caseSummary: analysis.caseSummary, issues: analysis.issues, clarifications: clar, transcript, evidenceChecklist: analysis.evidenceChecklist });
console.log("\nEVIDENCE TO COLLECT:"); for (const e of pkg.evidenceToCollect) console.log(` - ${e.item} (${e.fromWhom}) — ${e.reason}${e.clientNote ? " | client: " + e.clientNote : ""}`);
console.log(`\nPACKAGE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const c of pkg.corrections) console.log(`\n## ${c.title} [${c.status}]\n  before: ${JSON.stringify(c.before, null, 1)}\n  clar: ${JSON.stringify(c.clientClarification)}\n  proposed: ${JSON.stringify(c.proposedResolution)}\n  why: ${c.rationale}`);
console.log("\nEMAIL:", pkg.email.to, "|", pkg.email.subject, "\n" + pkg.email.body);
