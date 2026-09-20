// Smoke test for the local (no-API-key) pipeline: parse → analyze → converse → package.
import fs from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { demoAnalyze } from "../src/lib/demo/analysis.ts";
import { demoConverse } from "../src/lib/demo/agent.ts";
import { demoPackage } from "../src/lib/demo/package.ts";
import type { CaseDocument, Clarification, TranscriptTurn } from "../src/lib/types.ts";

async function load(): Promise<CaseDocument[]> {
  const dir = path.resolve("demo-documents");
  const docs: CaseDocument[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => /\.(pdf|docx)$/i.test(f))) {
    const buf = fs.readFileSync(path.join(dir, f));
    let text = "";
    if (f.endsWith(".pdf")) text = (await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })).text;
    else text = (await mammoth.extractRawText({ buffer: buf })).value;
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
    docs.push({ id: "d_" + f.slice(0, 6), name: f, kind: f.endsWith(".pdf") ? "pdf" : "docx", size: buf.length, text, uploadedAt: "" });
  }
  return docs;
}

const docs = await load();
const analysis = demoAnalyze(docs);
console.log("ISSUES:", analysis.issues.map((i) => `${i.id} [${i.kind}/${i.severity}] ev=${i.evidence.length} verified=${i.evidence.every((e) => e.verified)}`));
console.log("FACTS:", analysis.facts.length, "unverified:", analysis.facts.filter((f) => !f.evidence.verified).length);
for (const iss of analysis.issues) for (const e of iss.evidence) console.log("  ", iss.id, "|", e.docName, "|", e.quote.slice(0, 90));

const script = process.argv[2] === "b"
  ? ["I started in January but I wasn't full time then", "I was a contractor, yeah", "March 1st", "I was staying with my cousin in Atlanta", "It was 415 Ponce de Leon Avenue, apartment 9", "Yes the whole time", "No, I never went to the UK", "Hmm, oh wait, actually yes, I went to London for a friend's wedding"]
  : ["Right, I was contracting for Northstar from January 15 and then they hired me full time on March 1st", "I sublet a place in Atlanta, 415 Ponce de Leon Ave NE, Apt 9, Atlanta, GA 30308", "Yes, January through April", "Sorry, what was the question?", "Yes that trip happened, it was a vacation", "I think HR has the I-797, I only have the receipt", "Yes I have both degree certificates", "I have the agreement but not sure about invoices", "Yes, I have the I-20 and EAD"];

const transcript: TranscriptTurn[] = [];
let clar: Clarification[] = [];
let res = demoConverse({ caseSummary: analysis.caseSummary, issues: analysis.issues, plan: analysis.resolutionPlan, evidenceChecklist: analysis.evidenceChecklist, clarifications: clar, transcript, clientUtterance: null });
console.log("\nAGENT:", res.speech);
transcript.push({ id: "t0", role: "agent", text: res.speech, ts: "" });
for (const line of script) {
  if (res.endCall) break;
  console.log("CLIENT:", line);
  res = demoConverse({ caseSummary: analysis.caseSummary, issues: analysis.issues, plan: analysis.resolutionPlan, evidenceChecklist: analysis.evidenceChecklist, clarifications: clar, transcript, clientUtterance: line });
  transcript.push({ id: "c", role: "client", text: line, ts: "" }, { id: "a", role: "agent", text: res.speech, ts: "" });
  for (const u of res.updates) clar = [...clar.filter((c) => c.issueId !== u.issueId), u];
  console.log("AGENT:", res.speech, res.updates.length ? "\n   -> " + res.updates.map((u) => `${u.issueId}=${u.status} ${JSON.stringify(u.findings)}`).join("\n   -> ") : "");
}
console.log("\nEND CALL:", res.endCall);
const pkg = demoPackage({ caseSummary: analysis.caseSummary, issues: analysis.issues, clarifications: clar, transcript, evidenceChecklist: analysis.evidenceChecklist });
for (const c of pkg.corrections) console.log("\n##", c.title, "[" + c.status + "]\n  before:", c.before.length, "\n  clar:", c.clientClarification, "\n  proposed:", c.proposedResolution);
console.log("\n" + pkg.email.subject + "\n" + pkg.email.body);
