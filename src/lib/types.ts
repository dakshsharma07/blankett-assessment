// Shared domain model for Blankett Resolve.
//
// The pipeline is:  SOURCE EVIDENCE → AI INTERPRETATION (issues) → CLIENT CLARIFICATION
//                   → PROPOSED CORRECTION → ATTORNEY REVIEW → APPROVED CORRECTION
// Nothing downstream mutates the uploaded documents; every derived object points back at them.

export type DocKind = "pdf" | "docx" | "txt";

export interface CaseDocument {
  id: string;
  name: string;
  kind: DocKind;
  size: number;
  pages?: number;
  text: string;
  uploadedAt: string;
  /** True when the client supplied the document during the clarification call. */
  receivedDuringCall?: boolean;
}

/** A verbatim passage in an uploaded document. */
export interface Evidence {
  docId: string;
  docName: string;
  /** Where in the document (e.g. "Address History", "Experience"). */
  section: string;
  /** Verbatim (or near-verbatim) quote from the document text. */
  quote: string;
  /** True when the quote was located in the extracted text of the document. */
  verified: boolean;
}

export interface Fact {
  id: string;
  /** Machine-friendly grouping, e.g. "employment", "address", "travel", "identity". */
  category: string;
  label: string;
  value: string;
  evidence: Evidence;
}

export type IssueKind =
  | "conflict" // two sources state different values
  | "gap" // a required interval is missing
  | "omission" // a fact present in one source is absent from another
  | "clarification"; // ambiguous, needs the client

export type IssueSeverity = "high" | "medium" | "low";

export interface Issue {
  id: string;
  title: string;
  kind: IssueKind;
  severity: IssueSeverity;
  /** One or two sentences: what does not reconcile. */
  summary: string;
  /** Why the system flagged it (the reasoning, inspectable by the user). */
  whyFlagged: string;
  evidence: Evidence[];
  /** When another document may already explain the discrepancy. */
  possibleExplanation?: string;
  /** What the system still needs to learn. */
  needToKnow: string;
  /** The question the agent will open with. */
  suggestedQuestion: string;
  /** False for issues the attorney can resolve from the file without calling the client. */
  requiresClientContact: boolean;
}

export type ClarificationStatus = "resolved" | "partial" | "unresolved";

export interface ClarificationFinding {
  label: string;
  value: string;
}

/** The structured result of talking to the client about one issue. */
export interface Clarification {
  issueId: string;
  status: ClarificationStatus;
  /** The agent's faithful paraphrase of what the client said. */
  clientStatement: string;
  findings: ClarificationFinding[];
  /** What the agent believes the correction should be, given the client's answer. */
  proposedResolution: string;
  /** Anything the attorney should know (e.g. client was unsure). */
  notes?: string;
  updatedAt: string;
}

export interface TranscriptTurn {
  id: string;
  role: "agent" | "client" | "system";
  text: string;
  ts: string;
  issueId?: string | null;
  /** Agent turns only: the reasoning trace behind the speech. */
  reasoning?: string[];
}

export type CorrectionStatus =
  | "proposed" // AI proposed, not yet reviewed
  | "unresolved" // client could not resolve; requires follow-up
  | "accepted" // attorney accepted as proposed
  | "edited" // attorney edited then accepted
  | "rejected"; // attorney rejected

export interface Correction {
  id: string;
  issueId: string;
  title: string;
  /** The existing evidence, one line per source. */
  before: string[];
  /** What the client said, in structured lines. */
  clientClarification: string[];
  /** What the system proposes to change. */
  proposedResolution: string[];
  rationale: string;
  status: CorrectionStatus;
  /** Attorney's edited version of the resolution (when status === "edited"). */
  attorneyResolution?: string[];
  attorneyNote?: string;
}

/** A field-level change to the case record, rendered as a redline on the sign-off screen. */
export interface RecordChange {
  id: string;
  /** The correction this change belongs to. */
  correctionId: string;
  /** Which document / form is affected, e.g. "DS-160". */
  document: string;
  /** Field or section name, e.g. "Most Recent Arrival". */
  field: string;
  /** Current value; empty string when the field is missing. */
  from: string;
  /** Proposed value. */
  to: string;
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}

export interface CaseSummary {
  clientName: string;
  caseType: string;
  employer?: string;
  attorney: string;
  matterNumber?: string;
  summary: string;
}

export type PlanApproach = "ask_client" | "attorney_confirms_from_file" | "request_document";

/** The agent's plan for closing one issue, produced at analysis time. */
export interface PlanStep {
  issueId: string;
  approach: PlanApproach;
  objective: string;
  askFirst: string;
  ifUnclear: string;
  documentsThatWouldHelp: string[];
  fieldsAffected: Array<{ document: string; field: string }>;
  /** Second-order questions to ask once the primary issue is settled (e.g. how a contractor period was paid). */
  followUps: string[];
}

export type EvidenceStatus = "present" | "missing" | "unclear";

/** One item of the case-type evidence checklist, judged against the uploaded file. */
export interface EvidenceCheck {
  item: string;
  status: EvidenceStatus;
  /** Why it matters for this case type, and what in the file supports the status. */
  why: string;
  /** Document that satisfies it, when present. */
  foundIn?: string;
  /** True when the client is the right person to ask about it on the call. */
  askClient: boolean;
  /** The question to ask the client, if askClient. */
  question: string;
}

export interface AnalysisResult {
  caseSummary: CaseSummary;
  facts: Fact[];
  issues: Issue[];
  /** Ordered plan for resolving the issues; drives the call order and the impact summary. */
  resolutionPlan: PlanStep[];
  /** What a complete file for this case type should contain, judged against what was uploaded. */
  evidenceChecklist: EvidenceCheck[];
  /** "live" = model-driven; "demo" = deterministic local analysis. */
  engine: "live" | "demo";
  engineLabel: string;
  model?: string;
}

export interface ConverseRequest {
  caseSummary: CaseSummary;
  issues: Issue[];
  /** The resolution plan from analysis; sets the call order and fallback strategies. */
  plan?: PlanStep[];
  /** Missing/unclear evidence the agent may ask the client about after the issues are settled. */
  evidenceChecklist?: EvidenceCheck[];
  clarifications: Clarification[];
  transcript: TranscriptTurn[];
  /** null on the opening turn. */
  clientUtterance: string | null;
  /** A document the client sent mid-call; the agent reads it and reacts. */
  event?: { type: "document_received"; docName: string; excerpt: string };
}

export interface ConverseResponse {
  speech: string;
  /** Short, audience-readable trace of how this turn was decided: heard → checked → decided. */
  reasoning: string[];
  focusIssueId: string | null;
  updates: Clarification[];
  endCall: boolean;
  engine: "live" | "demo";
}

export interface PackageRequest {
  caseSummary: CaseSummary;
  issues: Issue[];
  clarifications: Clarification[];
  transcript: TranscriptTurn[];
  /** Documents the client supplied during the call, with an excerpt of their text. */
  callDocuments?: Array<{ name: string; excerpt: string }>;
  evidenceChecklist?: EvidenceCheck[];
}

/** A document or record the attorney still needs to obtain after the call. */
export interface EvidenceRequest {
  item: string;
  reason: string;
  fromWhom: "client" | "employer" | "attorney file" | "other";
  /** What the client said about it on the call, if anything. */
  clientNote?: string;
}

export interface PackageResponse {
  corrections: Correction[];
  recordChanges: RecordChange[];
  evidenceToCollect: EvidenceRequest[];
  email: EmailDraft;
  engine: "live" | "demo";
}

export interface EngineStatus {
  live: boolean;
  model: string;
  label: string;
  /** Which speech provider the server can offer; the client falls back to "browser" on failure. */
  voice: "elevenlabs" | "browser";
  /** Whether the speech provider can also transcribe the client (a key may allow speech but not transcription). */
  transcription: boolean;
  /** Real phone calling via Twilio, when configured. */
  phone: { configured: boolean; to: string | null; from: string | null; publicUrl: string | null };
}
