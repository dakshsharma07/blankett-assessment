"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall, Smartphone, Lightbulb, ChevronDown, ChevronRight, ChevronUp, Plus, X, UserCheck, Paperclip, Check, Minus, CircleDashed } from "lucide-react";
import { useCase } from "@/lib/store";
import type { EvidenceCheck, Issue, PlanStep } from "@/lib/types";
import { Button, Card, Chip, ClarificationStatusChip, SeverityChip, cx } from "@/components/ui";
import { EvidenceLink } from "@/components/Evidence";

// The verification page, in the order the work flows: what the file says,
// what still has to be settled with the client, and what the file is missing.

const TABS = ["facts", "call", "completeness"] as const;
type Tab = (typeof TABS)[number];

export default function CasePage() {
  const router = useRouter();
  const analysis = useCase((s) => s.analysis);
  const documents = useCase((s) => s.documents);
  const clarifications = useCase((s) => s.clarifications);
  const callState = useCase((s) => s.callState);
  const pkg = useCase((s) => s.pkg);
  const phoneConfigured = useCase((s) => !!s.engine?.phone.configured);
  const [tab, setTab] = useState<Tab>("facts");

  useEffect(() => {
    if (!analysis) router.replace("/");
  }, [analysis, router]);

  const issues = useMemo(() => analysis?.issues ?? [], [analysis]);
  const plan = useMemo(() => analysis?.resolutionPlan ?? [], [analysis]);
  const checklist = useMemo(() => analysis?.evidenceChecklist ?? [], [analysis]);
  const facts = useMemo(() => analysis?.facts ?? [], [analysis]);
  const firstName = analysis?.caseSummary.clientName.split(" ")[0] ?? "the client";

  const rank = useMemo(() => new Map(plan.map((p, i) => [p.issueId, i])), [plan]);
  const ordered = useMemo(() => [...issues].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999)), [issues, rank]);
  const onCall = ordered.filter((i) => i.requiresClientContact);
  const fromFile = ordered.filter((i) => !i.requiresClientContact);
  const evidenceAsk = checklist.filter((e) => e.status !== "present" && e.askClient);
  const missing = checklist.filter((e) => e.status === "missing");

  if (!analysis) return null;

  const statusOf = (i: Issue) => clarifications.find((c) => c.issueId === i.id)?.status ?? ("open" as const);

  return (
    <div className="fade-up">
      {/* Caption block: the matter, the docket details in two columns, and the call buttons, closed by a double rule. */}
      <div className="caption mb-6 flex flex-wrap items-start gap-x-10 gap-y-5 lg:flex-nowrap">
        <div className="min-w-0 shrink-0">
          <h1 className="page-title">{analysis.caseSummary.clientName}</h1>
          <div className="mt-1 text-[14px] text-ink-2">{analysis.caseSummary.caseType}</div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-8 gap-y-3 lg:flex-nowrap lg:border-l lg:border-border lg:pl-8 [&_dd]:whitespace-nowrap">
          <dl className="caption-table content-start">
            {analysis.caseSummary.matterNumber && (
              <>
                <dt>Matter</dt>
                <dd>{analysis.caseSummary.matterNumber}</dd>
              </>
            )}
            <dt>Attorney</dt>
            <dd>{analysis.caseSummary.attorney}</dd>
            {analysis.caseSummary.employer && (
              <>
                <dt>Employer</dt>
                <dd>{analysis.caseSummary.employer}</dd>
              </>
            )}
          </dl>
          <dl className="caption-table content-start">
            <dt>Documents</dt>
            <dd>{documents.length} in the file</dd>
            <dt>On the call</dt>
            <dd>
              <span className={cx(onCall.length > 0 && "text-amber")}>
                {onCall.length} item{onCall.length === 1 ? "" : "s"}
              </span>
            </dd>
            {checklist.length > 0 && (
              <>
                <dt>To collect</dt>
                <dd>{missing.length === 0 ? "Nothing, the file is complete" : <span className="text-amber">{missing.length} document{missing.length === 1 ? "" : "s"}</span>}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="w-full shrink-0 sm:w-[260px]">
          {callState === "ended" && pkg ? (
            <Button className="w-full" onClick={() => router.push("/review")}>
              View correction package
            </Button>
          ) : callState === "ended" ? (
            <Button className="w-full" onClick={() => router.push("/call")}>
              Generate corrections
            </Button>
          ) : (
            <>
              <Button size="lg" className="w-full" onClick={() => router.push("/call?start=browser")} disabled={onCall.length === 0} icon={<PhoneCall size={16} />}>
                Call the client about {onCall.length} item{onCall.length === 1 ? "" : "s"}
              </Button>
              {phoneConfigured && (
                <Button variant="ghost" className="mt-1.5 w-full" onClick={() => router.push("/call?start=phone")} disabled={onCall.length === 0} icon={<Smartphone size={14} />}>
                  Call {firstName} by phone
                </Button>
              )}
            </>
          )}
          {callState === "ended" && (
            <div className="mt-1.5 text-center text-[11.5px] text-ink-3">{pkg ? "Review, edit and sign off on each correction" : "Builds the correction package from the call"}</div>
          )}
        </div>
      </div>

      {/* One tab per stage of the verification: what the file says, what the client must settle, what is missing. */}
      <div className="mb-4 flex flex-wrap items-baseline gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium", tab === t ? "border-navy text-navy" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t === "facts" ? `Extracted facts (${facts.length})` : t === "call" ? `On the call (${onCall.length})` : `Completeness (${missing.length} to collect)`}
          </button>
        ))}
        <span className="ml-auto pb-2 text-[12.5px] text-ink-2">
          {tab === "facts"
            ? "What the file says, each with its source passage."
            : tab === "call"
              ? "What only the client can settle, in the order the agent will raise it."
              : "What a complete file for this case type contains, judged against the upload."}
        </span>
      </div>

      {tab === "facts" ? (
        <FactsTable />
      ) : tab === "call" ? (
        <>
          <CallAgenda items={onCall} plan={plan} statusOf={statusOf} evidenceAsk={evidenceAsk} />
          {fromFile.length > 0 && <SettledFromFile items={fromFile} plan={plan} />}
        </>
      ) : (
        <CompletenessTable checklist={checklist} />
      )}
    </div>
  );
}

/* ---------- 1. Extracted facts ---------- */

function FactsTable() {
  const facts = useCase((s) => s.analysis?.facts ?? []);
  const groups = useMemo(() => {
    const m = new Map<string, typeof facts>();
    for (const f of facts) m.set(f.category, [...(m.get(f.category) ?? []), f]);
    return [...m.entries()];
  }, [facts]);
  if (facts.length === 0) return <Card className="text-center text-sm text-ink-2">No facts were extracted.</Card>;
  return (
    <Card padded={false}>
      <table className="w-full text-[12.5px]">
        <tbody>
          {groups.map(([cat, list]) => (
            <Fragment key={cat}>
              <tr className="border-b border-border bg-surface-2/60">
                <td colSpan={3} className="px-4 py-1.5">
                  <span className="heading capitalize">{cat}</span>
                </td>
              </tr>
              {list.map((f) => (
                <tr key={f.id} className="border-b border-border align-top last:border-b-0">
                  <td className="w-[220px] px-4 py-2 text-ink-2">{f.label}</td>
                  <td className="px-4 py-2 font-medium text-ink">{f.value}</td>
                  <td className="w-[300px] max-w-[300px] px-4 py-2">
                    <EvidenceLink e={f.evidence} className="max-w-full" />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ---------- 2. On the call ---------- */

function CallAgenda({ items, plan, statusOf, evidenceAsk }: { items: Issue[]; plan: PlanStep[]; statusOf: (i: Issue) => "open" | "resolved" | "partial" | "unresolved"; evidenceAsk: EvidenceCheck[] }) {
  const addCallItem = useCase((s) => s.addCallItem);
  const removeCallItem = useCase((s) => s.removeCallItem);
  const moveCallItem = useCase((s) => s.moveCallItem);
  const callState = useCase((s) => s.callState);
  const [draft, setDraft] = useState("");
  const submit = () => {
    if (!draft.trim()) return;
    addCallItem(draft);
    setDraft("");
  };
  return (
    <Card padded={false}>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-ink-2">Nothing needs the client. Add an item below if there is something you want asked.</div>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((i, idx) => (
            <AgendaItem
              key={i.id}
              n={idx + 1}
              issue={i}
              step={plan.find((p) => p.issueId === i.id)}
              status={statusOf(i)}
              onRemove={i.id.startsWith("attorney-") && callState === "idle" ? () => removeCallItem(i.id) : undefined}
              onMoveUp={callState === "idle" && idx > 0 ? () => moveCallItem(i.id, -1) : undefined}
              onMoveDown={callState === "idle" && idx < items.length - 1 ? () => moveCallItem(i.id, 1) : undefined}
            />
          ))}
        </ol>
      )}

      {evidenceAsk.length > 0 && (
        <div className="border-t border-border bg-surface-2/50 px-4 py-3">
          <div className="text-[12px] text-ink-2">
            <span className="font-medium text-ink">Then checks whether the client has</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {evidenceAsk.map((e) => (
              <Chip key={e.item} tone="neutral">
                <Paperclip size={11} /> {shortItem(e.item)}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {callState === "idle" && (
        <form
          className="flex items-center gap-2 border-t border-border px-4 py-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          <Plus size={14} className="shrink-0 text-ink-3" />
          <input
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            placeholder="Add something for the agent to ask, e.g. confirm the client's current employer email"
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          <Button size="sm" variant="ghost" type="submit" disabled={!draft.trim()}>
            Add to call
          </Button>
        </form>
      )}
    </Card>
  );
}

function AgendaItem({ n, issue, step, status, onRemove, onMoveUp, onMoveDown }: { n: number; issue: Issue; step?: PlanStep; status: "open" | "resolved" | "partial" | "unresolved"; onRemove?: () => void; onMoveUp?: () => void; onMoveDown?: () => void }) {
  const [open, setOpen] = useState(false);
  const clarification = useCase((s) => s.clarifications.find((c) => c.issueId === issue.id));
  const custom = issue.id.startsWith("attorney-");
  const question = step?.askFirst || issue.suggestedQuestion;
  const fields = step?.fieldsAffected ?? [];
  const hasDetails = !custom && (issue.whyFlagged || step?.ifUnclear || (step?.followUps?.length ?? 0) > 0 || fields.length > 0 || (step?.documentsThatWouldHelp?.length ?? 0) > 0);
  return (
    <li className="px-4 py-3.5">
      <div className="flex gap-3">
        <span className="figure serif mt-0.5 w-5 shrink-0 text-[13px] text-ink-3">{n}.</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="serif text-[15.5px] leading-snug text-ink">{issue.title}</span>
            {custom ? <Chip tone="navy"><UserCheck size={11} /> Added by the attorney</Chip> : <SeverityChip severity={issue.severity} />}
            {status !== "open" && <ClarificationStatusChip status={status} />}
            {(onMoveUp || onMoveDown || onRemove) && (
              <span className="ml-auto flex items-center gap-0.5">
                {(onMoveUp || onMoveDown) && (
                  <>
                    <button onClick={onMoveUp} disabled={!onMoveUp} className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent" title="Ask earlier">
                      <ChevronUp size={14} />
                    </button>
                    <button onClick={onMoveDown} disabled={!onMoveDown} className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent" title="Ask later">
                      <ChevronDown size={14} />
                    </button>
                  </>
                )}
                {onRemove && (
                  <button onClick={onRemove} className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink" title="Remove from the call">
                    <X size={14} />
                  </button>
                )}
              </span>
            )}
          </div>
          {!custom && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{issue.summary}</p>}
          {issue.possibleExplanation && (
            <p className="mt-1 flex gap-1.5 text-[12.5px] leading-relaxed text-blue">
              <Lightbulb size={13} className="mt-0.5 shrink-0" />
              <span>{issue.possibleExplanation}</span>
            </p>
          )}
          {question && <p className="serif mt-2 text-[14px] italic leading-relaxed text-ink">“{question}”</p>}

          {(issue.evidence.length > 0 || fields.length > 0 || hasDetails) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {issue.evidence.map((e, k) => (
                <EvidenceLink key={k} e={e} />
              ))}
              {fields.length > 0 && (
                <span className="text-[12px] text-ink-3">
                  changes {fields.length} field{fields.length === 1 ? "" : "s"}
                </span>
              )}
              {hasDetails && (
                <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-0.5 text-[12px] text-navy hover:underline">
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Details
                </button>
              )}
            </div>
          )}

          {open && (
            <div className="mt-3 grid gap-x-6 gap-y-3 rounded-md border border-border bg-surface-2/50 p-3.5 text-[12.5px] leading-relaxed md:grid-cols-2">
              {issue.whyFlagged && (
                <Detail label="Why it was flagged">{issue.whyFlagged}</Detail>
              )}
              {step?.ifUnclear && <Detail label="If the client is unsure">{step.ifUnclear}</Detail>}
              {(step?.followUps?.length ?? 0) > 0 && (
                <Detail label="Then goes one level deeper">
                  <ul className="space-y-0.5">
                    {step!.followUps.map((q, k) => (
                      <li key={k} className="serif italic text-ink-2">“{q}”</li>
                    ))}
                  </ul>
                </Detail>
              )}
              {fields.length > 0 && (
                <Detail label="Fields that change once settled">
                  <ul className="space-y-0.5">
                    {fields.map((f, k) => (
                      <li key={k}>
                        <span className="font-medium text-ink">{f.document}</span> <span className="text-ink-3">›</span> {f.field}
                      </li>
                    ))}
                  </ul>
                </Detail>
              )}
              {(step?.documentsThatWouldHelp?.length ?? 0) > 0 && <Detail label="Would settle it">{step!.documentsThatWouldHelp.join("; ")}</Detail>}
            </div>
          )}

          {clarification && (
            <div className="mt-3 rounded-md border border-green/25 bg-green-soft p-3">
              <div className="text-[12px] font-semibold text-green">Client said</div>
              <p className="mt-0.5 text-[13px] text-ink">{clarification.clientStatement}</p>
              {clarification.findings.length > 0 && (
                <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[12.5px] sm:grid-cols-2">
                  {clarification.findings.map((f) => (
                    <div key={f.label} className="flex gap-2">
                      <dt className="text-ink-3">{f.label}:</dt>
                      <dd className="font-medium">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] font-semibold text-ink-3">{label}</div>
      <div className="mt-0.5 text-ink-2">{children}</div>
    </div>
  );
}

function SettledFromFile({ items, plan }: { items: Issue[]; plan: PlanStep[] }) {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-3">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <UserCheck size={13} /> Settled from the file, not raised with the client
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((i) => {
          const step = plan.find((p) => p.issueId === i.id);
          return (
            <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
              <span className="serif text-ink">{i.title}</span>
              <span className="text-ink-2">{step?.objective || i.summary}</span>
              <span className="flex flex-wrap gap-x-3">
                {i.evidence.map((e, k) => (
                  <EvidenceLink key={k} e={e} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- 3. Completeness ---------- */

function CompletenessTable({ checklist }: { checklist: EvidenceCheck[] }) {
  const clarifications = useCase((s) => s.clarifications);
  const documents = useCase((s) => s.documents);
  if (checklist.length === 0) return <Card className="text-center text-sm text-ink-2">No checklist was produced for this analysis.</Card>;
  const groups: Array<{ label: string; hint: string; items: EvidenceCheck[] }> = [
    { label: "Missing", hint: "not in the file, to be collected", items: checklist.filter((e) => e.status === "missing") },
    { label: "Unclear", hint: "in the file, but not settled", items: checklist.filter((e) => e.status === "unclear") },
    { label: "Present", hint: "satisfied by the upload", items: checklist.filter((e) => e.status === "present") },
  ];
  const icon = (s: EvidenceCheck["status"]) =>
    s === "present" ? <Check size={14} className="text-green" /> : s === "missing" ? <Minus size={14} className="text-red" /> : <CircleDashed size={14} className="text-amber" />;
  return (
    <Card padded={false}>
      <table className="w-full text-[12.5px]">
        <tbody>
          {groups.map(({ label, hint, items }) =>
            items.length === 0 ? null : (
              <Fragment key={label}>
                <tr className="border-b border-border bg-surface-2/60">
                  <td colSpan={3} className="px-4 py-1.5">
                    <span className="heading">{label}</span>
                    <span className="ml-2 text-[12px] text-ink-3">
                      {items.length}, {hint}
                    </span>
                  </td>
                </tr>
                {items.map((e) => {
                  const c = clarifications.find((x) => x.issueId === `evidence:${e.item}`);
                  const doc = e.foundIn ? documents.find((d) => d.name === e.foundIn) : undefined;
                  return (
                    <tr key={e.item} className="border-b border-border align-top last:border-b-0">
                      <td className="w-6 px-4 py-2">{icon(e.status)}</td>
                      <td className="px-2 py-2">
                        <span className="text-ink">{e.item}</span>
                        {c && (
                          <span className="ml-2 text-ink-2">
                            <span className="text-ink-3">Client: </span>
                            {c.clientStatement}
                          </span>
                        )}
                      </td>
                      <td className="w-[300px] max-w-[300px] px-4 py-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {e.foundIn && (
                            <span className="truncate text-[12px] text-ink-2" title={e.foundIn}>
                              {(doc?.name ?? e.foundIn).replace(/\.(pdf|docx|txt)$/i, "").replace(/_/g, " ")}
                            </span>
                          )}
                          {e.askClient && e.status !== "present" && (
                            <Chip tone="navy">
                              <PhoneCall size={11} /> On the call
                            </Chip>
                          )}
                          {c && <ClarificationStatusChip status={c.status} />}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </Card>
  );
}

/** Checklist items are written as a full requirement; the chip only needs the noun. */
function shortItem(item: string): string {
  return item.split(/\s[—(]/)[0].replace(/\s*\/.*$/, "").trim();
}

