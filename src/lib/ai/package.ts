import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { client, MODEL } from "@/lib/ai/client";
import { PackageSchema } from "@/lib/ai/schemas";
import type { PackageRequest, PackageResponse } from "@/lib/types";

const SYSTEM = `You produce the post-call correction package for a case-resolution system used by immigration attorneys.

Inputs: the issues found across the case documents (with verbatim evidence), the structured clarifications recorded during the client call, and the call transcript.

Produce:
1. One correction per issue, in this structure:
   - before: one line per source document stating what it currently says (use the evidence; name the document).
   - clientClarification: what the client said, as concrete lines (dates, addresses, purposes). Empty if the issue is unresolved.
   - proposedResolution: the concrete changes to the case record, one per line — e.g. "Record January 15 – February 29, 2024 as an independent-contractor engagement with Northstar Systems LLC." For unresolved issues, state exactly what follow-up is needed instead.
   - rationale: why this resolution follows from the evidence and the clarification.
   - status: "proposed" when the client resolved it; "unresolved" otherwise.
   - recordChanges: the exact field-level edits, one per affected field — document, field name, current value, proposed value. "from" and "to" are VALUES ONLY (e.g. from "March 1, 2024", not "Employment Start Date March 1, 2024"); "from" is empty when the field is blank or missing. Only for resolved items; leave empty when the value is still unknown.
   Issues that did not require client contact still get a correction whose clientClarification is empty and whose proposedResolution is what the attorney should confirm from the file (with recordChanges when the correct value is already in the file).
2. evidenceToCollect: every document or record still needed after the call — checklist items that are missing or unclear, anything the client promised to send, anything an unresolved item depends on — with who should supply it and what the client said about it (from the "evidence:" clarifications or the transcript).
3. A concise professional email from the case-resolution system to the supervising attorney summarizing the proposed corrections and any outstanding items, for their review before anything is changed. Plain text, no markdown. Address it to the attorney named in the case summary by first name if one is named, and sign it "Case-resolution assistant" on one line with the firm name on the next.

Rules:
- Use ONLY facts from the evidence, the clarifications, and the transcript. Never add details the client did not give.
- Never imply any correction is final, approved, filed, or legally sufficient. The attorney decides.
- Never assess credibility, eligibility, or approval likelihood.`;

export async function livePackage(req: PackageRequest): Promise<PackageResponse> {
  const issues = req.issues
    .map((i) => {
      const ev = i.evidence.map((e) => `    - ${e.docName} (${e.section}): "${e.quote}"`).join("\n");
      const c = req.clarifications.find((x) => x.issueId === i.id);
      const clar = c
        ? `  clarification: status=${c.status}; client said: ${c.clientStatement}; findings: ${c.findings.map((f) => `${f.label}=${f.value}`).join("; ") || "none"}; proposed: ${c.proposedResolution}${c.notes ? `; notes: ${c.notes}` : ""}`
        : i.requiresClientContact
          ? "  clarification: (client was not asked / no answer recorded)"
          : "  clarification: (attorney-only issue, no client contact required)";
      return `- issueId: ${i.id}\n  title: ${i.title}\n  kind: ${i.kind}\n  summary: ${i.summary}\n${i.possibleExplanation ? `  possible explanation in file: ${i.possibleExplanation}\n` : ""}  evidence:\n${ev}\n${clar}`;
    })
    .join("\n\n");
  const evidenceClar = req.clarifications
    .filter((c) => c.issueId.startsWith("evidence:"))
    .map((c) => `- ${c.issueId.slice(9)}: ${c.status} — ${c.clientStatement}${c.findings.length ? ` [${c.findings.map((f) => `${f.label}=${f.value}`).join("; ")}]` : ""}`)
    .join("\n");
  const transcript = req.transcript
    .filter((t) => t.role !== "system")
    .map((t) => `${t.role === "agent" ? "AGENT" : "CLIENT"}: ${t.text}`)
    .join("\n");

  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(PackageSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `${req.evidenceChecklist?.length ? `EVIDENCE CHECKLIST (from analysis)\n${req.evidenceChecklist.map((e) => `- ${e.item}: ${e.status}${e.foundIn ? ` (${e.foundIn})` : ""} — ${e.why}`).join("\n")}\n\n` : ""}${req.callDocuments?.length ? `DOCUMENTS RECEIVED FROM THE CLIENT DURING THE CALL (may support or change a correction; cite them by name in 'before' or rationale when used)\n${req.callDocuments.map((d) => `<document name="${d.name}">\n${d.excerpt}\n</document>`).join("\n")}\n\n` : ""}CASE\nClient: ${req.caseSummary.clientName}\nCase type: ${req.caseSummary.caseType}\nAttorney: ${req.caseSummary.attorney}\nMatter: ${req.caseSummary.matterNumber ?? "n/a"}\n\nISSUES AND CLARIFICATIONS\n${issues}${evidenceClar ? `\n\nEVIDENCE DISCUSSED ON THE CALL\n${evidenceClar}` : ""}\n\nCALL TRANSCRIPT\n${transcript || "(no call was held)"}\n\nProduce the correction package and attorney email.`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined to generate the package.");
  const out = msg.parsed_output;
  if (!out) throw new Error("The model response could not be parsed into a correction package.");

  return {
    corrections: out.corrections.map((c, i) => ({
      id: `corr_${i + 1}`,
      issueId: c.issueId,
      title: c.title,
      before: c.before,
      clientClarification: c.clientClarification,
      proposedResolution: c.proposedResolution,
      rationale: c.rationale,
      status: c.status,
    })),
    recordChanges: out.corrections.flatMap((c, i) =>
      c.recordChanges.map((r, j) => ({ id: `chg_${i + 1}_${j + 1}`, correctionId: `corr_${i + 1}`, document: r.document, field: r.field, from: r.from, to: r.to })),
    ),
    evidenceToCollect: out.evidenceToCollect.map((e) => ({ item: e.item, reason: e.reason, fromWhom: e.fromWhom, clientNote: e.clientNote ?? undefined })),
    email: out.email,
    engine: "live",
  };
}
