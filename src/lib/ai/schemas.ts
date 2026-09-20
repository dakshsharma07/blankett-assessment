import { z } from "zod";

export const EvidenceRefSchema = z.object({
  docName: z.string().describe("Exact file name of the uploaded document, as given"),
  section: z.string().describe("Heading or section of the document the quote comes from"),
  quote: z.string().describe("Verbatim passage copied from the document text, 3-40 words"),
});

export const PlanStepSchema = z.object({
  issueId: z.string(),
  approach: z.enum(["ask_client", "attorney_confirms_from_file", "request_document"]),
  objective: z.string().describe("What resolving this achieves for the filing, in one sentence"),
  askFirst: z.string().describe("The first question to ask the client; empty if the client is not asked"),
  ifUnclear: z.string().describe("Fallback strategy if the client is unsure, disagrees with a document, or gives a partial answer"),
  documentsThatWouldHelp: z.array(z.string()).describe("Documents the client could supply that would settle it (e.g. 'sublease or utility bill'); empty if none"),
  fieldsAffected: z
    .array(z.object({ document: z.string(), field: z.string() }))
    .describe("Every form field or record entry that will change once this is resolved, e.g. {document:'DS-160', field:'Countries Visited (Last Five Years)'}"),
  followUps: z
    .array(z.string())
    .describe("0-2 second-order questions an experienced paralegal would ask once this is settled — consequences the client may not have considered (how a period was paid, whether an address change was reported, whether a document exists). Spoken, one sentence each."),
});

export const EvidenceCheckSchema = z.object({
  item: z.string().describe("The document or evidence a complete file of this case type should contain"),
  status: z.enum(["present", "missing", "unclear"]),
  why: z.string().describe("Why it matters for this case type and what in the file supports the status"),
  foundIn: z.string().nullable().describe("Exact file name that satisfies it, when present"),
  askClient: z.boolean().describe("True if the client is the right person to ask about it on the call"),
  question: z.string().describe("Spoken question for the client if askClient; else empty"),
});

export const AnalysisSchema = z.object({
  caseSummary: z.object({
    clientName: z.string(),
    caseType: z.string(),
    employer: z.string().nullable(),
    attorney: z.string().describe("Attorney or firm named in the documents; 'Not stated' if none"),
    matterNumber: z.string().nullable(),
    summary: z.string().describe("2-3 sentences: what the case is and how well the documents reconcile"),
  }),
  facts: z
    .array(
      z.object({
        category: z.enum(["identity", "employment", "address", "travel", "education", "other"]),
        label: z.string(),
        value: z.string(),
        evidence: EvidenceRefSchema,
      }),
    )
    .describe("The case-relevant facts extracted from the documents, one per source statement"),
  issues: z.array(
    z.object({
      id: z.string().describe("short snake_case key, e.g. employment_timeline"),
      title: z.string(),
      kind: z.enum(["conflict", "gap", "omission", "clarification"]),
      severity: z.enum(["high", "medium", "low"]),
      summary: z.string(),
      whyFlagged: z.string().describe("The reasoning that led to flagging this, written for an attorney"),
      evidence: z.array(EvidenceRefSchema),
      possibleExplanation: z
        .string()
        .nullable()
        .describe("If another document already plausibly explains the discrepancy, say how; else null"),
      needToKnow: z.string().describe("What must be learned to close this issue"),
      suggestedQuestion: z.string().describe("The exact opening question to ask the client; empty if requiresClientContact is false"),
      requiresClientContact: z.boolean(),
    }),
  ),
  resolutionPlan: z
    .array(PlanStepSchema)
    .describe("One step per issue, in the order the agent should work through them on the call (client-contact steps first, most consequential first; attorney-only steps last)"),
  evidenceChecklist: z
    .array(EvidenceCheckSchema)
    .describe("The evidence a complete file for this case type should contain, each judged present / missing / unclear against the uploaded documents. 6-12 items."),
});
export type AnalysisOut = z.infer<typeof AnalysisSchema>;

export const ClarificationUpdateSchema = z.object({
  issueId: z.string(),
  status: z.enum(["resolved", "partial", "unresolved"]),
  clientStatement: z.string().describe("Faithful paraphrase of what the client actually said about this issue"),
  findings: z.array(z.object({ label: z.string(), value: z.string() })),
  proposedResolution: z.string().describe("The concrete correction to the case record, or what remains open"),
  notes: z.string().nullable(),
});

export const ConverseSchema = z.object({
  reasoning: z
    .array(z.string())
    .describe("Two or three short steps (each under 100 characters) showing how you decided this turn, in order: what the client just said or did; which document(s) or record you checked it against, with the specific value; what you concluded; why the next question follows. Written for a case manager watching live. Plain, concrete, no hedging."),
  focusIssueId: z.string().nullable().describe("The issue currently being discussed, or null"),
  endCall: z.boolean().describe("True only after every client-contact issue is resolved or marked unresolved and you have said goodbye"),
  speech: z.string().describe("Exactly what the agent says next, in natural spoken English"),
  // Last on purpose: the phone path releases the speech as soon as it closes and lets the updates finish streaming.
  updates: z.array(ClarificationUpdateSchema).describe("Structured record updates justified by what the client has said so far; empty if nothing new"),
});
export type ConverseOut = z.infer<typeof ConverseSchema>;

export const PackageSchema = z.object({
  corrections: z.array(
    z.object({
      issueId: z.string(),
      recordChanges: z
        .array(
          z.object({
            document: z.string().describe("The form or record affected, e.g. 'DS-160', 'Intake questionnaire', 'Case record'"),
            field: z.string().describe("Field or section name as it appears on that form"),
            from: z.string().describe("Current value verbatim; empty string if the field is missing or blank"),
            to: z.string().describe("Proposed value"),
          }),
        )
        .describe("Concrete field-level edits implied by this correction; empty for unresolved items"),
      title: z.string(),
      before: z.array(z.string()).describe("One line per source document: '<Document>: <what it says>'"),
      clientClarification: z.array(z.string()).describe("What the client said, as short structured lines; empty if unresolved"),
      proposedResolution: z.array(z.string()).describe("Concrete record changes, one per line; or what follow-up is needed"),
      rationale: z.string(),
      status: z.enum(["proposed", "unresolved"]),
    }),
  ),
  evidenceToCollect: z
    .array(
      z.object({
        item: z.string(),
        reason: z.string(),
        fromWhom: z.enum(["client", "employer", "attorney file", "other"]),
        clientNote: z.string().nullable().describe("What the client said about it on the call, if anything"),
      }),
    )
    .describe("Documents or records still needed after the call: missing checklist items, anything the client promised to send, anything an unresolved item depends on"),
  email: z.object({
    to: z.string(),
    subject: z.string(),
    body: z.string().describe("Plain-text professional email; no markdown"),
  }),
});
export type PackageOut = z.infer<typeof PackageSchema>;
