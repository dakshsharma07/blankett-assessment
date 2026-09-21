import type { Fact } from "@/lib/types";

export interface ClientPhone {
  /** As written in the document, e.g. "(404) 555-0142". */
  display: string;
  /** E.164 for dialing, e.g. "+14045550142". */
  e164: string;
  /** The document it was taken from. */
  docName: string;
}

/** Turn a phone number as written in a document into E.164 (North American numbers assumed when no country code is given). */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits.length >= 11 ? digits : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** The client's phone number, when the analysis extracted one from the file. */
export function clientPhoneFromFacts(facts: Fact[]): ClientPhone | null {
  for (const f of facts) {
    if (!/phone|mobile|telephone|cell/i.test(f.label)) continue;
    if (/employer|attorney|firm|office|emergency/i.test(f.label)) continue;
    const m = /(\+?\d[\d\s().-]{8,}\d)/.exec(f.value);
    if (!m) continue;
    const e164 = toE164(m[1]);
    if (e164) return { display: m[1].trim(), e164, docName: f.evidence.docName };
  }
  return null;
}
