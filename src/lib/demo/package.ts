// Deterministic correction package + email, built purely from the evidence and the
// clarification record. Used when no model credential is configured.

import type { Correction, EmailDraft, EvidenceRequest, PackageRequest, PackageResponse, RecordChange } from "@/lib/types";
import { attorneyParts } from "@/lib/firm";

function shortDoc(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
}

export function demoPackage(req: PackageRequest): PackageResponse {
  const corrections: Correction[] = req.issues.map((issue, i) => {
    const c = req.clarifications.find((x) => x.issueId === issue.id);
    const before = issue.evidence.map((e) => `${shortDoc(e.docName)}: "${e.quote}"`);

    if (!issue.requiresClientContact) {
      return {
        id: `corr_${i + 1}`,
        issueId: issue.id,
        title: issue.title,
        before,
        clientClarification: [],
        proposedResolution: [issue.needToKnow],
        rationale: issue.possibleExplanation ?? issue.whyFlagged,
        status: "proposed",
      };
    }
    if (!c || c.status === "unresolved" || c.status === "partial") {
      return {
        id: `corr_${i + 1}`,
        issueId: issue.id,
        title: issue.title,
        before,
        clientClarification: c ? [c.clientStatement, ...c.findings.map((f) => `${f.label}: ${f.value}`)] : [],
        proposedResolution: [c?.proposedResolution ?? "Not discussed on the call. Attorney to follow up with the client in writing."],
        rationale: c?.notes ? `Marked ${c.status} on the call — ${c.notes}.` : "The client did not provide enough information to close this issue.",
        status: "unresolved",
      };
    }
    return {
      id: `corr_${i + 1}`,
      issueId: issue.id,
      title: issue.title,
      before,
      clientClarification: [c.clientStatement, ...c.findings.map((f) => `${f.label}: ${f.value}`)],
      proposedResolution: c.proposedResolution
        .split(/;\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".")),
      rationale: issue.possibleExplanation
        ? `The client's account matches the explanation already present in the file: ${issue.possibleExplanation}`
        : `The client supplied the missing or corrected information directly; the proposed change makes the record consistent with the client's statement and the existing evidence.`,
      status: "proposed",
    };
  });

  // Field-level redline for the sample case, derived from the recorded findings.
  const recordChanges: RecordChange[] = [];
  for (const c of corrections) {
    if (c.status !== "proposed") continue;
    const cl = req.clarifications.find((x) => x.issueId === c.issueId);
    const f = Object.fromEntries((cl?.findings ?? []).map((x) => [x.label, x.value]));
    const push = (document: string, field: string, from: string, to: string) =>
      recordChanges.push({ id: `chg_${recordChanges.length + 1}`, correctionId: c.id, document, field, from, to });
    if (c.issueId === "employment_timeline" && f["Full-time employment start"]) {
      push("Case record", "Northstar relationship · Jan 15 – Feb 29, 2024", "", `Independent contractor (${f["Contractor start"] ?? "January 15, 2024"} – day before full-time start)`);
      push("DS-160", "Employment Start Date", "March 1, 2024", `${f["Full-time employment start"]} (full-time; contractor period noted separately)`);
    }
    if (c.issueId === "address_gap" && f["Street address"]) {
      const line = `${f["Street address"]}, ${f["City"] ?? ""}${f["State"] ? `, ${f["State"]}` : ""}${f["ZIP"] ? ` ${f["ZIP"]}` : ""}`.replace(/,\s*,/g, ",");
      push("DS-160", "Address History · Jan 1 – Apr 30, 2024", "", `${line} (${f["Dates"] ?? "January 1 – April 30, 2024"})`);
      push("Intake questionnaire", "Any other address in the last five years?", "No", `Yes — ${line}`);
    }
    if (c.issueId === "travel_omission" && f["Trip occurred"]) {
      push("DS-160", "Countries Visited (Last Five Years)", "Canada, India", "Canada, India, United Kingdom");
      push("Intake questionnaire", "Any other trips outside the U.S.?", "None that I recall", `London, United Kingdom · ${f["Dates"] ?? "February 14 – 21, 2024"}${f["Purpose"] ? ` · ${f["Purpose"]}` : ""}`);
    }
    if (c.issueId === "job_title") push("DS-160", "Job Title", "Software Engineer", "Software Engineer II");
  }

  const evidenceToCollect: EvidenceRequest[] = (req.evidenceChecklist ?? [])
    .filter((e) => e.status !== "present")
    .map((e) => {
      const c = req.clarifications.find((x) => x.issueId === `evidence:${e.item}`);
      return { item: e.item, reason: e.why, fromWhom: e.askClient ? "client" : /LCA|employer|I-797/i.test(e.item) ? "employer" : "attorney file", clientNote: c?.clientStatement };
    });

  const proposed = corrections.filter((c) => c.status === "proposed");
  const open = corrections.filter((c) => c.status === "unresolved");
  const attorneyName = attorneyParts(req.caseSummary.attorney).person ?? "Counsel";

  const lines: string[] = [];
  lines.push(`Dear ${attorneyName},`);
  lines.push("");
  lines.push(
    `Following the case-resolution call with ${req.caseSummary.clientName} (${req.caseSummary.caseType}${req.caseSummary.matterNumber ? `, matter ${req.caseSummary.matterNumber}` : ""}), below are the proposed corrections for your review. Nothing has been changed on the file; each item requires your approval.`,
  );
  lines.push("");
  if (proposed.length) {
    lines.push("PROPOSED CORRECTIONS");
    proposed.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.title}`);
      if (c.clientClarification.length) lines.push(`   Client clarification: ${c.clientClarification[0]}`);
      c.proposedResolution.forEach((r) => lines.push(`   Proposed: ${r}`));
    });
    lines.push("");
  }
  if (open.length) {
    lines.push("OUTSTANDING ITEMS");
    open.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.title}`);
      c.proposedResolution.forEach((r) => lines.push(`   ${r}`));
    });
    lines.push("");
  }
  if (evidenceToCollect.length) {
    lines.push("EVIDENCE STILL TO COLLECT");
    evidenceToCollect.forEach((e, i) => lines.push(`${i + 1}. ${e.item} (${e.fromWhom})${e.clientNote ? ` — client: ${e.clientNote}` : ""}`));
    lines.push("");
  }
  lines.push("Source evidence for every item is attached to the correction package, alongside the call transcript.");
  lines.push("");
  lines.push("Regards,");
  lines.push("Case-resolution assistant");
  lines.push(attorneyParts(req.caseSummary.attorney).firm);

  const email: EmailDraft = {
    to: `${attorneyName} <attorney@example.com>`,
    subject: `Proposed corrections for review — ${req.caseSummary.clientName}${req.caseSummary.matterNumber ? ` (${req.caseSummary.matterNumber})` : ""}`,
    body: lines.join("\n"),
  };

  return { corrections, recordChanges, evidenceToCollect, email, engine: "demo" };
}
