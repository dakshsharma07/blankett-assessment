import type { CaseDocument, Evidence } from "@/lib/types";

/** Collapse whitespace and punctuation variants so quotes survive PDF text extraction quirks. */
export function canon(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to find `quote` in `text`. Returns the verbatim slice from the document when found
 * (so the UI shows exactly what the document says), otherwise null.
 */
export function locateQuote(text: string, quote: string): string | null {
  const ct = canon(text);
  const cq = canon(quote);
  if (!cq) return null;
  // Direct match on the canonical form.
  let idx = ct.indexOf(cq);
  if (idx === -1) {
    // Fall back to the longest run of words that still matches (handles a model
    // quoting across a line break that extraction rendered differently).
    const words = cq.split(" ");
    for (let len = words.length - 1; len >= Math.min(4, words.length); len--) {
      for (let start = 0; start + len <= words.length; start++) {
        const sub = words.slice(start, start + len).join(" ");
        const i = ct.indexOf(sub);
        if (i !== -1) {
          idx = i;
          return extractOriginal(text, ct, idx, sub.length);
        }
      }
    }
    return null;
  }
  return extractOriginal(text, ct, idx, cq.length);
}

// Map an index in the canonical string back onto the original text. The canonical form only
// collapses whitespace, so we walk both strings in parallel.
function extractOriginal(orig: string, ct: string, cIdx: number, cLen: number): string {
  let oi = 0;
  let ci = 0;
  let start = -1;
  let end = -1;
  const origLower = orig
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase();
  while (oi < origLower.length && ci <= ct.length) {
    const ch = origLower[oi];
    const isWs = /\s/.test(ch);
    if (isWs) {
      // canonical has a single space for any whitespace run (or none at the edges)
      let oj = oi;
      while (oj < origLower.length && /\s/.test(origLower[oj])) oj++;
      if (ct[ci] === " ") ci++;
      oi = oj;
    } else {
      if (ci === cIdx && start === -1) start = oi;
      ci++;
      oi++;
      if (ci === cIdx + cLen && end === -1) {
        end = oi;
        break;
      }
    }
  }
  if (start === -1) return orig.slice(0, Math.min(orig.length, cLen));
  if (end === -1) end = orig.length;
  return orig.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Resolve an evidence reference produced by the model (doc name + quote) to a verified Evidence. */
export function resolveEvidence(
  docs: CaseDocument[],
  ref: { docName: string; section: string; quote: string },
): Evidence {
  const doc = findDoc(docs, ref.docName);
  if (!doc) {
    return { docId: "", docName: ref.docName, section: ref.section, quote: ref.quote, verified: false };
  }
  const found = locateQuote(doc.text, ref.quote);
  return {
    docId: doc.id,
    docName: doc.name,
    section: ref.section,
    quote: found ?? ref.quote,
    verified: found !== null,
  };
}

export function findDoc(docs: CaseDocument[], name: string): CaseDocument | undefined {
  const cn = canon(name);
  return (
    docs.find((d) => canon(d.name) === cn) ??
    docs.find((d) => canon(d.name).includes(cn) || cn.includes(canon(d.name))) ??
    docs.find((d) => canon(d.name.replace(/\.[a-z0-9]+$/i, "")) === cn.replace(/\.[a-z0-9]+$/i, ""))
  );
}
