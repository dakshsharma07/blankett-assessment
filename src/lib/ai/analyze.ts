import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { client, MODEL } from "@/lib/ai/client";
import { AnalysisSchema } from "@/lib/ai/schemas";
import { resolveEvidence } from "@/lib/evidence";
import type { AnalysisResult, CaseDocument } from "@/lib/types";

const SYSTEM = `You are the case-analysis engine of a case-resolution system used by immigration attorneys to reconcile a client's case file before filing.

You receive the extracted text of every document in one case. Treat them as ONE case, not separate documents.

Your job:
1. Extract the case-relevant facts (identity, employment, addresses, travel, education) with the exact source passage for each.
2. Compare facts ACROSS documents and identify where the case does not reconcile:
   - conflict: two sources state different values for the same fact
   - gap: a required continuous history (addresses, employment) has a missing interval
   - omission: a fact appears in one source but is absent from another where it should appear
   - clarification: something ambiguous that only the client can settle
3. For each issue, decide whether another document already offers a plausible explanation (e.g. a letter that says an earlier date was contractor work). If so, say so in possibleExplanation — the issue still needs client confirmation, but it is a distinction to confirm rather than a contradiction to resolve.
4. Decide whether the client must be contacted (requiresClientContact). Minor formatting differences the attorney can settle from the file (e.g. "Software Engineer" vs "Software Engineer II" when the employer letter is authoritative) should be flagged with low severity and requiresClientContact=false.
5. Produce the resolutionPlan: one step per issue, ordered as the agent should work through them. For each: the approach, the objective, the opening question, the fallback strategy if the client is unsure or disagrees, documents that would settle it, EVERY form field or record entry that will change once it is resolved (be exhaustive and concrete — a single omitted trip can affect the DS-160 countries list, the most-recent-arrival field and the intake answer), and 0-2 followUps: the second-order questions an experienced paralegal would ask once the primary fact is settled — consequences the client may not have considered (how a contractor period was paid and documented; whether a move was reported to USCIS within the required window; whether a degree certificate and transcripts exist; whether the employer will confirm a date in writing). Follow-ups must be grounded in this case's facts, not generic.
6. Judge case completeness. Using the CASE-TYPE REQUIREMENTS below (adapt them if the case type differs), build the evidenceChecklist: what a complete file should contain, and for each item whether the uploaded documents satisfy it (present, naming the file), do not (missing), or partially (unclear). Mark askClient=true only where the client — not the employer or attorney — is the right person to answer, and write the spoken question.
7. Write suggestedQuestion as the exact, natural, spoken opening question a professional case-resolution agent would ask the client — reference the specific documents and values, and mention any possible explanation so the client can confirm or correct it.

CASE-TYPE REQUIREMENTS (H-1B consular processing; adapt for other case types)
- Approved I-129 petition / I-797 approval notice (receipt number should match the DS-160)
- Certified Labor Condition Application (LCA) with the work location matching the address history and employer letter
- Employer support / verification letter: title, duties, salary, start date, work location
- Evidence of the beneficiary's degree(s): diploma and transcripts for every degree relied on; credential evaluation for foreign degrees
- Resume / CV consistent with the petition
- Passport valid for the intended period; prior visas
- Continuous five-year address history and employment history with no unexplained gaps
- Evidence for any period of work that differs from the petition (contractor agreements, invoices, 1099s, pay records)
- Complete international travel history for the last five years, consistent with passport stamps
- Evidence of maintenance of status if currently in the U.S. (e.g. I-20 / OPT EAD for F-1 holders), including any change-of-address filings
- DS-160 confirmation consistent with all of the above

Rules:
- Recognize semantic equivalence. "Northstar Systems LLC" and "Northstar Systems" are the same employer; "March 2024" is consistent with "March 1, 2024". Do not flag those.
- Every evidence quote must be copied VERBATIM from the document text you were given (3-40 words). Never paraphrase inside a quote.
- docName must be the exact file name shown in the <document name="..."> tag.
- Never assess credibility, truthfulness, fraud, eligibility, or likelihood of approval. Only reconcile facts.
- Do not invent facts that are not in the documents.
- Keep the issue list focused: 3 to 6 issues, ordered by importance. Fold derivative discrepancies into their parent issue (e.g. a "most recent arrival" field that is wrong only because a trip was omitted belongs inside the omitted-trip issue, mentioned in its summary and needToKnow) rather than listing them separately. Merge issues that the same client answer would resolve.
- requiresClientContact=true only when the client is the only source that can settle it. If the file already answers it (an authoritative employer letter, a degree listed on a resume that simply needs to be copied over), set it false and leave suggestedQuestion empty.
- suggestedQuestion must be a single spoken question of at most two sentences of context plus one question. Do not ask for documents or attachments on the call.`;

export async function liveAnalyze(docs: CaseDocument[]): Promise<AnalysisResult> {
  const corpus = docs
    .map((d) => `<document name="${d.name}" kind="${d.kind}">\n${d.text}\n</document>`)
    .join("\n\n");

  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: (process.env.BLANKETT_ANALYSIS_EFFORT as "low" | "medium" | "high") || "low", format: zodOutputFormat(AnalysisSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Analyze the following ${docs.length} documents as one immigration case.\n\n${corpus}`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined to analyze these documents.");
  const out = msg.parsed_output;
  if (!out) throw new Error("The model response could not be parsed into a case analysis.");

  const facts = out.facts.map((f, i) => ({
    id: `f${i + 1}`,
    category: f.category,
    label: f.label,
    value: f.value,
    evidence: resolveEvidence(docs, f.evidence),
  }));

  const seen = new Set<string>();
  const issues = out.issues.map((iss, i) => {
    let id = iss.id.replace(/[^a-z0-9_]/gi, "_").toLowerCase() || `issue_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    return {
      id,
      title: iss.title,
      kind: iss.kind,
      severity: iss.severity,
      summary: iss.summary,
      whyFlagged: iss.whyFlagged,
      evidence: iss.evidence.map((e) => resolveEvidence(docs, e)),
      possibleExplanation: iss.possibleExplanation ?? undefined,
      needToKnow: iss.needToKnow,
      suggestedQuestion: iss.suggestedQuestion,
      requiresClientContact: iss.requiresClientContact,
    };
  });

  const validIds = new Set(issues.map((i) => i.id));
  const resolutionPlan = out.resolutionPlan
    .map((p) => ({ ...p, issueId: p.issueId.replace(/[^a-z0-9_]/gi, "_").toLowerCase() }))
    .filter((p) => validIds.has(p.issueId));
  // Guarantee every issue has a step, even if the model skipped one.
  for (const i of issues) {
    if (!resolutionPlan.some((p) => p.issueId === i.id)) {
      resolutionPlan.push({
        issueId: i.id,
        approach: i.requiresClientContact ? "ask_client" : "attorney_confirms_from_file",
        objective: i.needToKnow,
        askFirst: i.suggestedQuestion,
        ifUnclear: "Record as unresolved and flag for attorney follow-up.",
        documentsThatWouldHelp: [],
        fieldsAffected: [],
        followUps: [],
      });
    }
  }

  return {
    caseSummary: {
      clientName: out.caseSummary.clientName,
      caseType: out.caseSummary.caseType,
      employer: out.caseSummary.employer ?? undefined,
      attorney: out.caseSummary.attorney,
      matterNumber: out.caseSummary.matterNumber ?? undefined,
      summary: out.caseSummary.summary,
    },
    facts,
    issues,
    resolutionPlan,
    evidenceChecklist: out.evidenceChecklist.map((e) => ({
      item: e.item,
      status: e.status,
      why: e.why,
      foundIn: e.foundIn ?? undefined,
      askClient: e.askClient,
      question: e.question,
    })),
    engine: "live",
    engineLabel: `Live AI analysis, ${MODEL}`,
    model: MODEL,
  };
}
