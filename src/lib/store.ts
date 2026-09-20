"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  AnalysisResult,
  CaseDocument,
  Clarification,
  Correction,
  CorrectionStatus,
  EmailDraft,
  EngineStatus,
  EvidenceRequest,
  PackageResponse,
  RecordChange,
  TranscriptTurn,
} from "@/lib/types";

export type CallState = "idle" | "active" | "ended";

export interface SignOff {
  approvedAt: string;
  approvedBy: string;
  accepted: number;
  edited: number;
  rejected: number;
  unresolved: number;
}

interface CaseStore {
  engine: EngineStatus | null;
  documents: CaseDocument[];
  analysis: AnalysisResult | null;
  clarifications: Clarification[];
  transcript: TranscriptTurn[];
  callState: CallState;
  pkg: PackageResponse | null;
  corrections: Correction[];
  recordChanges: RecordChange[];
  evidenceToCollect: EvidenceRequest[];
  email: EmailDraft | null;
  signOff: SignOff | null;

  setEngine: (e: EngineStatus) => void;
  addDocuments: (docs: CaseDocument[]) => void;
  /** Adds a document supplied mid-call without invalidating the analysis or the call. */
  addCallDocument: (doc: CaseDocument) => void;
  removeDocument: (id: string) => void;
  setAnalysis: (a: AnalysisResult | null) => void;
  upsertClarification: (c: Clarification) => void;
  appendTranscript: (t: TranscriptTurn) => void;
  setCallState: (s: CallState) => void;
  resetCall: () => void;
  setPackage: (p: PackageResponse) => void;
  setCorrectionStatus: (id: string, status: CorrectionStatus, attorneyResolution?: string[], note?: string) => void;
  setEmail: (e: EmailDraft) => void;
  approve: (by: string) => void;
  resetAll: () => void;
}

const empty = {
  documents: [] as CaseDocument[],
  analysis: null as AnalysisResult | null,
  clarifications: [] as Clarification[],
  transcript: [] as TranscriptTurn[],
  callState: "idle" as CallState,
  pkg: null as PackageResponse | null,
  corrections: [] as Correction[],
  recordChanges: [] as RecordChange[],
  evidenceToCollect: [] as EvidenceRequest[],
  email: null as EmailDraft | null,
  signOff: null as SignOff | null,
};

export const useCase = create<CaseStore>()(
  persist(
    (set) => ({
      engine: null,
      ...empty,

      setEngine: (engine) => set({ engine }),
      addDocuments: (docs) =>
        set((s) => {
          // Re-uploading a file with the same name replaces the earlier copy.
          const names = new Set(docs.map((d) => d.name));
          const kept = s.documents.filter((d) => !names.has(d.name));
          // Any change to the document set invalidates downstream work.
          return { ...empty, documents: [...kept, ...docs] };
        }),
      addCallDocument: (doc) => set((s) => ({ documents: [...s.documents.filter((d) => d.name !== doc.name), { ...doc, receivedDuringCall: true }] })),
      removeDocument: (id) => set((s) => ({ ...empty, documents: s.documents.filter((d) => d.id !== id) })),
      setAnalysis: (analysis) => set({ analysis, clarifications: [], transcript: [], callState: "idle", pkg: null, corrections: [], email: null, signOff: null }),
      upsertClarification: (c) =>
        set((s) => ({ clarifications: [...s.clarifications.filter((x) => x.issueId !== c.issueId), c] })),
      appendTranscript: (t) => set((s) => ({ transcript: [...s.transcript, t] })),
      setCallState: (callState) => set({ callState }),
      resetCall: () => set({ clarifications: [], transcript: [], callState: "idle", pkg: null, corrections: [], email: null, signOff: null }),
      setPackage: (pkg) => set({ pkg, corrections: pkg.corrections, recordChanges: pkg.recordChanges ?? [], evidenceToCollect: pkg.evidenceToCollect ?? [], email: pkg.email, signOff: null }),
      setCorrectionStatus: (id, status, attorneyResolution, attorneyNote) =>
        set((s) => ({
          corrections: s.corrections.map((c) => (c.id === id ? { ...c, status, attorneyResolution, attorneyNote } : c)),
        })),
      setEmail: (email) => set({ email }),
      approve: (by) =>
        set((s) => ({
          signOff: {
            approvedAt: new Date().toISOString(),
            approvedBy: by,
            accepted: s.corrections.filter((c) => c.status === "accepted").length,
            edited: s.corrections.filter((c) => c.status === "edited").length,
            rejected: s.corrections.filter((c) => c.status === "rejected").length,
            unresolved: s.corrections.filter((c) => c.status === "unresolved").length,
          },
        })),
      resetAll: () => set({ ...empty }),
    }),
    {
      name: "blankett-resolve-case",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        documents: s.documents,
        analysis: s.analysis,
        clarifications: s.clarifications,
        transcript: s.transcript,
        callState: s.callState === "active" ? "idle" : s.callState,
        pkg: s.pkg,
        corrections: s.corrections,
        recordChanges: s.recordChanges,
        evidenceToCollect: s.evidenceToCollect,
        email: s.email,
        signOff: s.signOff,
      }),
    },
  ),
);

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
