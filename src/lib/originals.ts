// The original uploaded files, kept in memory for viewing. The case store persists only the
// extracted text; the bytes live here as object URLs for the life of the tab. After a reload the
// bundled sample files can still be fetched from /demo-documents.

import type { CaseDocument } from "@/lib/types";

const urls = new Map<string, string>();

/** Register the files that produced `docs` (matched by file name). */
export function registerOriginals(files: File[], docs: CaseDocument[]) {
  if (typeof window === "undefined") return;
  for (const d of docs) {
    const f = files.find((x) => x.name === d.name);
    if (f) urls.set(d.id, URL.createObjectURL(f));
  }
}

const SAMPLE = new Set([
  "DS-160_Application_Summary_Maya_Patel.pdf",
  "Resume_Maya_Patel.pdf",
  "Employment_Verification_Letter_Northstar.pdf",
  "Travel_History_Record_Maya_Patel.pdf",
  "Client_Intake_Questionnaire_Maya_Patel.docx",
]);
const SAMPLE_DURING_CALL = new Set(["Sublease_Agreement_415_Ponce_de_Leon.pdf"]);

/** URL of the original file, or null when it is no longer available (uploaded before a reload). */
export function originalUrl(doc: CaseDocument): string | null {
  const u = urls.get(doc.id);
  if (u) return u;
  if (SAMPLE.has(doc.name)) return `/demo-documents/${doc.name}`;
  if (SAMPLE_DURING_CALL.has(doc.name)) return `/demo-documents/during-call/${doc.name}`;
  return null;
}
