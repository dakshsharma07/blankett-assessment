"use client";

import { useState } from "react";
import { Download, FileText, ShieldCheck, ShieldAlert, X } from "lucide-react";
import type { CaseDocument, Evidence } from "@/lib/types";
import { useCase } from "@/lib/store";
import { originalUrl } from "@/lib/originals";
import { cx } from "@/components/ui";

export function docIcon(kind: CaseDocument["kind"]) {
  return <FileText size={14} strokeWidth={1.75} className={kind === "pdf" ? "text-navy" : kind === "docx" ? "text-blue" : "text-ink-3"} />;
}

/** One verbatim passage with its source. Click the source to open the full document text. */
export function EvidenceCard({ e, compact = false }: { e: Evidence; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const doc = useCase((s) => s.documents.find((d) => d.id === e.docId));
  return (
    <div className={cx("rounded-md border border-border bg-surface", compact ? "p-2.5" : "p-3")}>
      <div className="mb-2 flex items-center gap-2 text-[12px]">
        {docIcon(doc?.kind ?? "pdf")}
        <button
          onClick={() => doc && setOpen(true)}
          className={cx("truncate font-medium text-ink", doc && "hover:underline")}
          title={doc ? "Open source document" : "Document not found"}
        >
          {e.docName}
        </button>
        <span className="truncate text-ink-3">{e.section}</span>
        <span className="ml-auto shrink-0" title={e.verified ? "Quote located verbatim in the uploaded document" : "Quote could not be located verbatim in the document text"}>
          {e.verified ? <ShieldCheck size={13} className="text-green" /> : <ShieldAlert size={13} className="text-amber" />}
        </span>
      </div>
      <div className="quote">“{e.quote}”</div>
      {open && doc && <DocumentViewer doc={doc} highlight={e.quote} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function DocumentViewer({ doc, highlight, onClose }: { doc: CaseDocument; highlight?: string; onClose: () => void }) {
  const url = originalUrl(doc);
  const canRender = url !== null && doc.kind === "pdf";
  // An evidence click opens on the extracted text so the passage is highlighted; otherwise show the file itself.
  const [view, setView] = useState<"original" | "text">(canRender && !highlight ? "original" : "text");
  const parts = splitHighlight(doc.text, highlight);
  const tab = (v: "original" | "text", label: string) => (
    <button
      onClick={() => setView(v)}
      className={cx("h-7 rounded px-2.5 text-[12px] transition-colors", view === v ? "bg-navy text-white" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
    >
      {label}
    </button>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className={cx("flex max-h-[90vh] w-full flex-col rounded-lg border border-border-strong bg-surface shadow-2xl", view === "original" ? "max-w-5xl" : "max-w-3xl")} onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          {docIcon(doc.kind)}
          <div className="min-w-0">
            <div className="serif truncate text-[15px] text-ink">{doc.name}</div>
            <div className="figure text-[11.5px] text-ink-3">
              {doc.kind.toUpperCase()}, {(doc.size / 1024).toFixed(1)} KB{doc.pages ? `, ${doc.pages} page${doc.pages === 1 ? "" : "s"}` : ""}.{" "}
              {view === "original" ? "The original file, unchanged." : "Text as extracted for analysis; the original file is unchanged."}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {url && (canRender ? tab("original", "Original") : (
              <a href={url} download={doc.name} className="flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                <Download size={13} /> Original
              </a>
            ))}
            {url && tab("text", "Extracted text")}
            <button onClick={onClose} className="ml-1 rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink">
              <X size={16} />
            </button>
          </div>
        </div>
        {view === "original" && url ? (
          <iframe src={url} title={doc.name} className="h-[80vh] w-full rounded-b-lg bg-surface-2" />
        ) : (
          <pre className="serif overflow-auto whitespace-pre-wrap px-8 py-6 text-[14px] leading-[1.6] text-ink">
            {parts.map((p, i) =>
              p.hit ? (
                <mark key={i} className="bg-amber-soft px-0.5 text-ink underline decoration-amber/60 decoration-1 underline-offset-2">
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

function splitHighlight(text: string, quote?: string): Array<{ text: string; hit: boolean }> {
  if (!quote) return [{ text, hit: false }];
  // Build a whitespace-tolerant regex from the quote.
  const words = quote.replace(/[“”"]/g, "").trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return [{ text, hit: false }];
  const re = new RegExp(words.join("\\s+"), "i");
  const m = re.exec(text);
  if (!m) return [{ text, hit: false }];
  return [
    { text: text.slice(0, m.index), hit: false },
    { text: m[0], hit: true },
    { text: text.slice(m.index + m[0].length), hit: false },
  ];
}
