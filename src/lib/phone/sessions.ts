// In-memory phone-call sessions. One Next.js process serves the demo, so a module-level map
// (pinned to globalThis to survive dev hot reloads) is sufficient. Nothing here persists.

import type { CaseSummary, Clarification, ConverseResponse, EvidenceCheck, Issue, PlanStep, TranscriptTurn } from "@/lib/types";

/** A generated agent turn plus, when natural voice is configured, the id of its audio clip. */
export interface PhoneReply {
  res: ConverseResponse;
  clip?: string;
}

export type PhoneStatus = "queued" | "ringing" | "in-progress" | "completed" | "failed" | "busy" | "no-answer" | "canceled";

export interface PhoneSession {
  id: string;
  to: string;
  callSid?: string;
  status: PhoneStatus;
  context: { caseSummary: CaseSummary; issues: Issue[]; plan: PlanStep[]; evidenceChecklist: EvidenceCheck[] };
  transcript: TranscriptTurn[];
  clarifications: Clarification[];
  focusIssueId: string | null;
  /** Set once the agent has said goodbye; the next TwiML hangs up. */
  agentEnded: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
  /** The agent turn currently being generated. Twilio is never made to wait on it: TwiML fetches
   *  return at once and poll for the result with short redirects. */
  pending?: Promise<PhoneReply>;
  /** The tail of the current turn (record updates) still streaming after its speech was released. */
  completing?: Promise<void>;
  /** Synthesised speech for recent turns, served to Twilio via /api/phone/audio. */
  audio: Map<string, Buffer>;
  unansweredPrompts: number;
}

const g = globalThis as unknown as { __blankettPhone?: Map<string, PhoneSession> };
const store = (g.__blankettPhone ??= new Map<string, PhoneSession>());

export function createSession(s: Omit<PhoneSession, "createdAt" | "updatedAt" | "transcript" | "clarifications" | "focusIssueId" | "agentEnded" | "pending" | "completing" | "audio" | "unansweredPrompts">): PhoneSession {
  const now = new Date().toISOString();
  const session: PhoneSession = { ...s, transcript: [], clarifications: [], focusIssueId: null, agentEnded: false, audio: new Map(), unansweredPrompts: 0, createdAt: now, updatedAt: now };
  store.set(session.id, session);
  return session;
}

export function getSession(id: string): PhoneSession | undefined {
  return store.get(id);
}

export function findByCallSid(callSid: string): PhoneSession | undefined {
  for (const s of store.values()) if (s.callSid === callSid) return s;
  return undefined;
}

export function touch(s: PhoneSession) {
  s.updatedAt = new Date().toISOString();
}

/** Public view for the browser to poll. */
export function publicView(s: PhoneSession) {
  return {
    id: s.id,
    to: s.to,
    status: s.status,
    transcript: s.transcript,
    clarifications: s.clarifications,
    focusIssueId: s.focusIssueId,
    ended: s.status === "completed" || s.status === "failed" || s.status === "busy" || s.status === "no-answer" || s.status === "canceled",
    error: s.error,
    updatedAt: s.updatedAt,
  };
}
