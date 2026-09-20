"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, Trash2, FolderOpen, AlertCircle, Eye } from "lucide-react";
import { useCase } from "@/lib/store";
import type { CaseDocument } from "@/lib/types";
import { Button, Card, SectionLabel, Spinner, cx } from "@/components/ui";
import { Check } from "lucide-react";
import { DocumentViewer, docIcon } from "@/components/Evidence";
import { registerOriginals } from "@/lib/originals";

const SAMPLE_FILES = [
  { name: "DS-160_Application_Summary_Maya_Patel.pdf", label: "DS-160 application summary", kind: "pdf" },
  { name: "Resume_Maya_Patel.pdf", label: "Resume / CV", kind: "pdf" },
  { name: "Employment_Verification_Letter_Northstar.pdf", label: "Employer verification letter", kind: "pdf" },
  { name: "Travel_History_Record_Maya_Patel.pdf", label: "International travel record", kind: "pdf" },
  { name: "Client_Intake_Questionnaire_Maya_Patel.docx", label: "Client intake questionnaire", kind: "docx" },
] as const;

const STAGES = [
  { at: 0, label: "Reading documents", detail: "Loading the extracted text of every file as one case" },
  { at: 6, label: "Extracting facts", detail: "Identity, employment, addresses, travel and education, each with its source passage" },
  { at: 22, label: "Cross-referencing sources", detail: "Comparing every fact against every other document for conflicts, gaps and omissions" },
  { at: 45, label: "Checking for explanations in the file", detail: "Looking for documents that already account for an apparent discrepancy" },
  { at: 62, label: "Drafting clarification questions", detail: "Deciding what only the client can settle, and how to ask" },
];

function AnalysisProgress({ live, docCount }: { live: boolean; docCount: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const scale = live ? 1 : 0.02; // demo mode finishes almost instantly
  const idx = STAGES.reduce((acc, s, i) => (elapsed >= s.at * scale ? i : acc), 0);
  return (
    <Card className="border-navy/30">
      <div className="flex items-center gap-3">
        <Spinner className="text-navy" />
        <div>
          <div className="serif text-[16px] text-ink">Analyzing {docCount} documents as one case</div>
          <div className="figure text-[12px] text-ink-3">{elapsed}s</div>
        </div>
      </div>
      <ol className="mt-4 space-y-2">
        {STAGES.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li key={s.label} className={cx("flex gap-3 text-[13px]", !done && !active && "opacity-40")}>
              <span className={cx("mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full border text-[10px]", done ? "border-green bg-green text-white" : active ? "border-navy text-navy" : "border-border-strong text-ink-3")}>
                {done ? <Check size={10} strokeWidth={3} /> : active ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy" /> : null}
              </span>
              <div>
                <div className={cx("font-medium", active && "text-navy")}>{s.label}</div>
                <div className="text-[12px] text-ink-3">{s.detail}</div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 text-[11.5px] text-ink-3">Every issue will cite the passages that caused it.</div>
    </Card>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const documents = useCase((s) => s.documents);
  const analysis = useCase((s) => s.analysis);
  const engine = useCase((s) => s.engine);
  const addDocuments = useCase((s) => s.addDocuments);
  const removeDocument = useCase((s) => s.removeDocument);
  const setAnalysis = useCase((s) => s.setAnalysis);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"parsing" | "analyzing" | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [viewing, setViewing] = useState<CaseDocument | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setErrors([]);
      setBusy("parsing");
      try {
        const fd = new FormData();
        files.forEach((f) => fd.append("files", f, f.name));
        const res = await fetch("/api/parse", { method: "POST", body: fd });
        const data = (await res.json()) as { documents: CaseDocument[]; errors: string[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Upload failed");
        if (data.documents.length) {
          registerOriginals(files, data.documents);
          addDocuments(data.documents);
        }
        if (data.errors?.length) setErrors(data.errors);
      } catch (e) {
        setErrors([e instanceof Error ? e.message : String(e)]);
      } finally {
        setBusy(null);
      }
    },
    [addDocuments],
  );

  const loadSample = async () => {
    setErrors([]);
    setBusy("parsing");
    try {
      const files = await Promise.all(
        SAMPLE_FILES.map(async (f) => {
          const r = await fetch(`/demo-documents/${f.name}`);
          if (!r.ok) throw new Error(`Could not fetch sample file ${f.name}`);
          const blob = await r.blob();
          return new File([blob], f.name, { type: f.kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
        }),
      );
      setBusy(null);
      await ingest(files);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      setBusy(null);
    }
  };

  const analyze = async () => {
    setErrors([]);
    setBusy("analyzing");
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documents }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalysis(data);
      router.push("/case");
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragging(false);
    ingest(Array.from(ev.dataTransfer.files));
  };

  return (
    <div className="fade-up">
      <div className="caption mb-7">
        <h1 className="page-title">Open a new case file</h1>
        <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink-2">Add every document in the file. They are read as one case.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors",
              dragging ? "border-navy bg-navy-soft" : "border-border-strong bg-surface hover:border-navy/60",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="hidden"
              onChange={(e) => {
                ingest(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <div className="grid h-11 w-11 place-items-center rounded-full border border-navy/30 text-navy">
              {busy === "parsing" ? <Spinner /> : <UploadCloud size={19} strokeWidth={1.75} />}
            </div>
            <div className="serif mt-4 text-[17px] text-ink">{busy === "parsing" ? "Extracting text…" : "Drop PDF or DOCX files here, or click to browse"}</div>
          </div>

          {busy === "analyzing" && <AnalysisProgress live={engine?.live ?? false} docCount={documents.length} />}

          {errors.length > 0 && (
            <div className="rounded-md border border-red/30 bg-red-soft px-4 py-3 text-[13px] text-red">
              {errors.map((e, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{e}</span>
                </div>
              ))}
            </div>
          )}

          <Card padded={false}>
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <SectionLabel meta={`${documents.length} document${documents.length === 1 ? "" : "s"}`}>Case file</SectionLabel>
              {analysis && <span className="text-[12px] text-green">Analyzed. Adding or removing documents will re-run analysis.</span>}
            </div>
            {documents.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-ink-3">No documents yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                    {docIcon(d.kind)}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{d.name}</div>
                      <div className="figure text-[11.5px] text-ink-3">
                        {d.kind.toUpperCase()}, {(d.size / 1024).toFixed(1)} KB{d.pages ? `, ${d.pages} page${d.pages === 1 ? "" : "s"}` : ""}, {d.text.split(/\s+/).length.toLocaleString()} words extracted
                      </div>
                    </div>
                    <button onClick={() => setViewing(d)} className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" title="View document">
                      <Eye size={15} />
                    </button>
                    <button onClick={() => removeDocument(d.id)} className="rounded p-1.5 text-ink-3 hover:bg-red-soft hover:text-red" title="Remove">
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <div className="text-[12.5px] text-ink-3">
                {documents.length < 2 ? "Add at least two documents to compare." : "Ready to analyze."}
              </div>
              <div className="flex gap-2">
                {analysis && (
                  <Button variant="secondary" onClick={() => router.push("/case")}>
                    View issues
                  </Button>
                )}
                <Button onClick={analyze} disabled={documents.length < 2 || busy !== null} icon={busy === "analyzing" ? <Spinner /> : undefined}>
                  {busy === "analyzing" ? "Analyzing case…" : analysis ? "Re-analyze case" : "Analyze case"}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card padded={false}>
            <div className="border-b border-border px-5 py-3">
              <SectionLabel>Matters</SectionLabel>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="serif text-[17px] text-navy">Patel, Maya</div>
                  <div className="mt-0.5 text-[12.5px] text-ink-2">H-1B consular processing</div>
                  <div className="figure mt-0.5 text-[11.5px] text-ink-3">SL-2024-0417, {SAMPLE_FILES.length} documents</div>
                </div>
                <Button variant="secondary" size="sm" onClick={loadSample} disabled={busy !== null} icon={<FolderOpen size={14} />}>
                  Open file
                </Button>
              </div>
              <ul className="mt-3 space-y-1">
                {SAMPLE_FILES.map((f) => (
                  <li key={f.name} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                    {docIcon(f.kind)}
                    <span className="min-w-0 flex-1 truncate" title={f.name}>
                      {f.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </div>
      {viewing && <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
