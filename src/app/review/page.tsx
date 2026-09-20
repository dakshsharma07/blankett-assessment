"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Pencil, Mail, Copy, ShieldCheck, ChevronDown, ChevronUp, Download, AlertTriangle, FileText, Diff, ClipboardList } from "lucide-react";
import { useCase } from "@/lib/store";
import type { Correction } from "@/lib/types";
import { Button, Card, CorrectionStatusChip, SectionLabel, cx } from "@/components/ui";
import { EvidenceCard } from "@/components/Evidence";

export default function ReviewPage() {
  const router = useRouter();
  const analysis = useCase((s) => s.analysis);
  const pkg = useCase((s) => s.pkg);
  const corrections = useCase((s) => s.corrections);
  const email = useCase((s) => s.email);
  const signOff = useCase((s) => s.signOff);
  const recordChanges = useCase((s) => s.recordChanges);
  const evidenceToCollect = useCase((s) => s.evidenceToCollect);
  const transcript = useCase((s) => s.transcript);
  const setEmail = useCase((s) => s.setEmail);
  const approve = useCase((s) => s.approve);
  // Prefill only when the file names an individual ("Daksh Sharma, Sharma LLP"); otherwise the reviewer types their name.
  const [reviewer, setReviewer] = useState(() => {
    const a = analysis?.caseSummary.attorney ?? "";
    return a.includes(",") ? a.split(",")[0].trim() : "";
  });
  const [attested, setAttested] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    if (!pkg) router.replace(analysis ? "/case" : "/");
  }, [pkg, analysis, router]);

  const pending = useMemo(() => corrections.filter((c) => c.status === "proposed"), [corrections]);
  const decided = corrections.filter((c) => c.status === "accepted" || c.status === "edited");
  const rejected = corrections.filter((c) => c.status === "rejected");
  const unresolved = corrections.filter((c) => c.status === "unresolved");
  const canApprove = pending.length === 0 && decided.length > 0 && attested && reviewer.trim().length > 1 && !signOff;

  if (!pkg || !analysis) return null;

  const copyEmail = async () => {
    if (!email) return;
    await navigator.clipboard.writeText(`To: ${email.to}\nSubject: ${email.subject}\n\n${email.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const exportPackage = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            case: analysis.caseSummary,
            engine: pkg.engine,
            signOff,
            corrections: corrections.map((c) => ({ ...c, evidence: analysis.issues.find((i) => i.id === c.issueId)?.evidence ?? [] })),
            recordChanges,
            evidenceToCollect,
            email,
            transcript,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `corrections-${analysis.caseSummary.clientName.replace(/\s+/g, "_")}.json`;
    a.click();
  };

  return (
    <div className="fade-up">
      <div className="caption mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Correction package</h1>
          <div className="mt-1 text-[14px] text-ink-2">
            {analysis.caseSummary.clientName}
            {analysis.caseSummary.matterNumber && <span className="figure text-ink-3">, matter {analysis.caseSummary.matterNumber}</span>}
          </div>
          <p className="mt-4 max-w-[64ch] text-[13.5px] leading-relaxed text-ink-2">Accept, edit or reject each correction, then sign off.</p>
        </div>
        <div className="flex gap-2 pb-1">
          <Button variant="secondary" onClick={() => setShowTranscript((v) => !v)} icon={<FileText size={14} />}>
            {showTranscript ? "Hide transcript" : "Call transcript"}
          </Button>
          <Button variant="secondary" onClick={exportPackage} icon={<Download size={14} />}>
            Export JSON
          </Button>
        </div>
      </div>

      {signOff && <FinalBanner />}

      {showTranscript && (
        <Card padded={false} className="mb-5">
          <div className="border-b border-border px-5 py-2.5">
            <SectionLabel meta={`${transcript.filter((t) => t.role !== "system").length} turns`}>Call transcript</SectionLabel>
          </div>
          <div className="max-h-[320px] space-y-2 overflow-y-auto px-5 py-3 text-[12.5px]">
            {transcript.map((t) => (
              <div key={t.id} className={cx(t.role === "system" && "text-center text-ink-3")}>
                {t.role !== "system" && <span className={cx("mr-2 font-semibold", t.role === "agent" ? "text-navy" : "text-ink")}>{t.role === "agent" ? "Agent" : "Client"}</span>}
                <span className="text-ink-2">{t.text}</span>
                {t.role === "agent" && t.reasoning && t.reasoning.length > 0 && (
                  <details className="ml-12 mt-0.5">
                    <summary className="cursor-pointer select-none text-[11.5px] text-ink-3 hover:text-ink">Why the agent said this</summary>
                    <ol className="mt-0.5 list-decimal space-y-0.5 pl-4 text-[12px] text-ink-3">
                      {t.reasoning.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {recordChanges.length > 0 && <Redline changes={recordChanges} corrections={corrections} approved={!!signOff} />}
          {corrections.map((c, idx) => (
            <CorrectionCard key={c.id} c={c} index={idx} locked={!!signOff} />
          ))}

          {evidenceToCollect.length > 0 && (
            <Card padded={false}>
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <ClipboardList size={15} className="text-amber" />
                <SectionLabel meta={`${evidenceToCollect.length} item${evidenceToCollect.length === 1 ? "" : "s"}`}>Evidence still to collect</SectionLabel>
              </div>
              <ul className="divide-y divide-border">
                {evidenceToCollect.map((e, i) => (
                  <li key={i} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{e.item}</span>
                      <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">from {e.fromWhom}</span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-ink-2">{e.reason}</div>
                    {e.clientNote && (
                      <div className="mt-0.5 text-[12px] text-ink">
                        <span className="font-medium">Client said: </span>
                        {e.clientNote}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Email */}
          {email && (
            <Card padded={false}>
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <Mail size={15} className="text-navy" />
                <SectionLabel meta="drafted for the reviewing attorney">Summary email</SectionLabel>
                <div className="ml-auto flex items-center gap-2">
                  {showEmail && (
                    <Button size="sm" variant="secondary" onClick={copyEmail} icon={<Copy size={13} />}>
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setShowEmail((v) => !v)} icon={showEmail ? <ChevronUp size={13} /> : <ChevronDown size={13} />}>
                    {showEmail ? "Hide" : "Show"}
                  </Button>
                </div>
              </div>
              {showEmail && (
              <div className="space-y-2 px-5 py-4">
                <div className="grid grid-cols-[70px_1fr] items-center gap-2 text-[12.5px]">
                  <span className="text-ink-3">To</span>
                  <input value={email.to} disabled={!!signOff} onChange={(e) => setEmail({ ...email, to: e.target.value })} className="rounded border border-border bg-surface px-2 py-1 outline-none focus:border-navy" />
                  <span className="text-ink-3">Subject</span>
                  <input value={email.subject} disabled={!!signOff} onChange={(e) => setEmail({ ...email, subject: e.target.value })} className="rounded border border-border bg-surface px-2 py-1 font-medium outline-none focus:border-navy" />
                </div>
                <textarea
                  value={email.body}
                  disabled={!!signOff}
                  onChange={(e) => setEmail({ ...email, body: e.target.value })}
                  rows={Math.min(26, email.body.split("\n").length + 2)}
                  className="w-full resize-y rounded border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-navy"
                />
                <div className="text-[11.5px] text-ink-3">Copy to send from your mail client.</div>
              </div>
              )}
            </Card>
          )}
        </div>

        {/* Sign-off panel */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-navy" />
              <span className="heading">Attorney review</span>
            </div>
            <dl className="caption-table mt-3">
              <dt>Pending</dt>
              <dd className={cx(pending.length > 0 && "text-amber")}>{pending.length}</dd>
              <dt>Accepted</dt>
              <dd className={cx(decided.length > 0 && "text-green")}>{decided.length}</dd>
              <dt>Rejected</dt>
              <dd>{rejected.length}</dd>
              <dt>Unresolved</dt>
              <dd className={cx(unresolved.length > 0 && "text-amber")}>{unresolved.length}</dd>
            </dl>
            {unresolved.length > 0 && !signOff && (
              <div className="mt-3 flex gap-2 rounded-md border border-amber/30 bg-amber-soft p-2.5 text-[12px] text-amber">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {unresolved.length} item{unresolved.length === 1 ? "" : "s"} could not be resolved on the call and will remain open after sign-off.
              </div>
            )}
            {!signOff ? (
              <>
                <label className="mt-5 block text-[12px] text-ink-3">Reviewing attorney</label>
                <input
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  placeholder="Type your name to sign"
                  className="serif mt-1 w-full border-0 border-b border-border-strong bg-transparent px-0 py-1.5 text-[19px] italic text-navy outline-none placeholder:not-italic placeholder:font-sans placeholder:text-[13px] placeholder:text-ink-3 focus:border-navy"
                />
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
                  <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
                  I have reviewed each proposed correction against the source evidence and the client&apos;s clarification.
                </label>
                <Button className="mt-4 w-full" size="lg" variant="success" disabled={!canApprove} onClick={() => approve(reviewer.trim())} icon={<Check size={16} />}>
                  Approve corrections
                </Button>
                <div className="mt-2 text-center text-[11.5px] text-ink-3">
                  {pending.length > 0 ? `Decide on ${pending.length} pending item${pending.length === 1 ? "" : "s"} to enable sign-off.` : decided.length === 0 ? "At least one correction must be accepted." : "Approval records your decision on each item. It does not file or submit anything."}
                </div>
              </>
            ) : (
              <div className="mt-5 border-t border-border-strong pt-3 text-[12.5px] text-ink-2">
                <div className="serif text-[21px] italic text-navy">{signOff.approvedBy}</div>
                <div className="mt-1">Approved {new Date(signOff.approvedAt).toLocaleString()}</div>
                <div className="figure mt-1 text-ink-3">
                  {signOff.accepted} accepted, {signOff.edited} with edits, {signOff.rejected} rejected, {signOff.unresolved} unresolved
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Field-level before/after view of the case record, grouped by document. */
function Redline({ changes, corrections, approved }: { changes: import("@/lib/types").RecordChange[]; corrections: Correction[]; approved: boolean }) {
  const statusOf = (c: import("@/lib/types").RecordChange) => corrections.find((x) => x.id === c.correctionId)?.status ?? "proposed";
  const groups = useMemo(() => {
    const m = new Map<string, typeof changes>();
    for (const c of changes) m.set(c.document, [...(m.get(c.document) ?? []), c]);
    return [...m.entries()];
  }, [changes]);
  const applied = changes.filter((c) => ["accepted", "edited"].includes(statusOf(c))).length;
  return (
    <Card padded={false} className="border-navy/30">
      <div className="flex items-center gap-2 border-b border-border bg-navy-soft/60 px-5 py-3">
        <Diff size={15} className="text-navy" />
        <SectionLabel meta={`${changes.length} field change${changes.length === 1 ? "" : "s"}`}>Case record redline</SectionLabel>
        <span className="ml-auto text-[11.5px] text-ink-3">{approved ? `${applied} approved for the next workflow step` : `${applied} of ${changes.length} accepted so far`}</span>
      </div>
      <div className="divide-y divide-border">
        {groups.map(([doc, list]) => (
          <div key={doc} className="px-5 py-3">
            <div className="serif mb-2 text-[14px] text-ink">{doc}</div>
            <table className="w-full text-[12.5px]">
              <tbody>
                {list.map((c) => {
                  const st = statusOf(c);
                  const on = st === "accepted" || st === "edited";
                  const off = st === "rejected";
                  return (
                    <tr key={c.id} className={cx("align-top", off && "opacity-45")}>
                      <td className="w-[210px] py-1.5 pr-3 text-ink-2">{c.field}</td>
                      <td className="py-1.5 pr-3">
                        {c.from ? <span className="rounded bg-red-soft px-1 text-red line-through decoration-red/60">{c.from}</span> : <span className="italic text-ink-3">— not recorded —</span>}
                      </td>
                      <td className="w-4 py-1.5 text-ink-3">→</td>
                      <td className="py-1.5 pr-3">
                        <span className={cx("rounded px-1", on ? "bg-green-soft text-green" : "bg-navy-soft text-navy")}>{c.to}</span>
                        {st === "edited" && <span className="ml-1.5 text-[11px] text-ink-3">(see attorney edit)</span>}
                      </td>
                      <td className="w-[92px] py-1.5 text-right text-[11px] font-medium">
                        {on ? <span className="text-green">Accepted</span> : off ? <span className="text-red">Rejected</span> : <span className="text-ink-3">Pending</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FinalBanner() {
  const router = useRouter();
  return (
    <div className="mb-5 rounded-lg border border-green/40 bg-green-soft p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-11 w-11 place-items-center rounded-full border border-green text-green">
          <Check size={22} strokeWidth={2.5} />
        </div>
        <div>
          <div className="serif text-[21px] text-green">Corrections approved</div>
          <div className="text-[13px] text-ink-2">Attorney review is complete. Ready for the next step: updating the case record and forms.</div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => router.push("/case")}>
            Back to case
          </Button>
        </div>
      </div>
    </div>
  );
}

function CorrectionCard({ c, index, locked }: { c: Correction; index: number; locked: boolean }) {
  const issue = useCase((s) => s.analysis?.issues.find((i) => i.id === c.issueId));
  const setStatus = useCase((s) => s.setCorrectionStatus);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState((c.attorneyResolution ?? c.proposedResolution).join("\n"));
  const [note, setNote] = useState(c.attorneyNote ?? "");
  const [showEvidence, setShowEvidence] = useState(false);
  const isUnresolved = c.status === "unresolved";
  const effective = c.attorneyResolution ?? c.proposedResolution;

  return (
    <Card padded={false} className={cx(c.status === "rejected" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <span className="figure text-[12px] text-ink-3">{index + 1}.</span>
        <span className="serif text-[16px] text-ink">{c.title}</span>
        <span className="ml-auto">
          <CorrectionStatusChip status={c.status} />
        </span>
      </div>

      <div className="grid gap-0 md:grid-cols-3 md:divide-x md:divide-border">
        <Column label="Existing evidence" tone="neutral">
          {c.before.map((b, i) => (
            <div key={i} className="text-[12.5px] leading-relaxed text-ink-2">
              {b}
            </div>
          ))}
        </Column>
        <Column label="Client clarification" tone={c.clientClarification.length ? "blue" : "neutral"}>
          {c.clientClarification.length === 0 ? (
            <div className="text-[12.5px] italic text-ink-3">{issue?.requiresClientContact ? "No clarification obtained." : "Not required — attorney to confirm from the file."}</div>
          ) : (
            c.clientClarification.map((l, i) => (
              <div key={i} className={cx("text-[12.5px] leading-relaxed", i === 0 ? "serif text-[13.5px] italic text-ink" : "text-ink-2")}>
                {i === 0 ? `“${l}”` : l}
              </div>
            ))
          )}
        </Column>
        <Column label={isUnresolved ? "Follow-up required" : c.status === "edited" ? "Approved resolution (edited)" : "Proposed resolution"} tone={isUnresolved ? "amber" : "green"}>
          {editing ? (
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] outline-none focus:border-navy" />
          ) : (
            effective.map((l, i) => (
              <div key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" />
                {l}
              </div>
            ))
          )}
          {c.attorneyNote && !editing && <div className="mt-2 text-[11.5px] text-ink-3">Attorney note: {c.attorneyNote}</div>}
        </Column>
      </div>

      <div className="border-t border-border px-5 py-3">
        <div className="text-[12px] text-ink-2">
          <span className="font-semibold text-ink">Why: </span>
          {c.rationale}
        </div>
        <button onClick={() => setShowEvidence((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-navy hover:underline">
          {showEvidence ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showEvidence ? "Hide" : "Show"} source passages ({issue?.evidence.length ?? 0})
        </button>
        {showEvidence && issue && (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {issue.evidence.map((e, i) => (
              <EvidenceCard key={i} e={e} compact />
            ))}
          </div>
        )}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-5 py-3">
          {editing ? (
            <>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional attorney note" className="h-8 flex-1 rounded border border-border bg-surface px-2 text-[12.5px] outline-none focus:border-navy" />
              <Button size="sm" variant="success" icon={<Check size={13} />} onClick={() => { setStatus(c.id, "edited", draft.split("\n").map((s) => s.trim()).filter(Boolean), note.trim() || undefined); setEditing(false); }}>
                Save & accept
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : isUnresolved ? (
            <>
              <span className="text-[12px] text-ink-3">This item stays open; it will be carried forward for follow-up.</span>
              <Button size="sm" variant="secondary" className="ml-auto" icon={<Pencil size={13} />} onClick={() => setEditing(true)}>
                Resolve manually
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant={c.status === "accepted" ? "success" : "secondary"} icon={<Check size={13} />} onClick={() => setStatus(c.id, "accepted")}>
                Accept
              </Button>
              <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant={c.status === "rejected" ? "danger" : "secondary"} icon={<X size={13} />} onClick={() => setStatus(c.id, "rejected")}>
                Reject
              </Button>
              {c.status !== "proposed" && (
                <button onClick={() => setStatus(c.id, "proposed")} className="ml-auto text-[12px] text-ink-3 hover:underline">
                  Reset decision
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function Column({ label, tone, children }: { label: string; tone: "neutral" | "blue" | "green" | "amber"; children: React.ReactNode }) {
  const color = { neutral: "text-ink-2", blue: "text-blue", green: "text-green", amber: "text-amber" }[tone];
  return (
    <div className="space-y-1.5 px-5 py-4">
      <div className={cx("heading mb-2 border-b border-border pb-1.5", color)}>{label}</div>
      {children}
    </div>
  );
}

