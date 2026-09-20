"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall, Smartphone, Lightbulb, HelpCircle, MessageSquareQuote, FileSearch, ListChecks, FileEdit, Paperclip, UserCheck, CircleHelp } from "lucide-react";
import { useCase } from "@/lib/store";
import type { EvidenceCheck, Issue, PlanStep } from "@/lib/types";
import { Button, Card, Chip, ClarificationStatusChip, KindChip, SectionLabel, SeverityChip, cx } from "@/components/ui";
import { EvidenceCard } from "@/components/Evidence";

export default function CasePage() {
  const router = useRouter();
  const analysis = useCase((s) => s.analysis);
  const documents = useCase((s) => s.documents);
  const clarifications = useCase((s) => s.clarifications);
  const callState = useCase((s) => s.callState);
  const pkg = useCase((s) => s.pkg);
  const phoneConfigured = useCase((s) => !!s.engine?.phone.configured);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"issues" | "plan" | "completeness" | "facts">("issues");

  useEffect(() => {
    if (!analysis) router.replace("/");
  }, [analysis, router]);

  const issues = useMemo(() => analysis?.issues ?? [], [analysis]);
  const selected = useMemo(() => issues.find((i) => i.id === selectedId) ?? issues[0], [issues, selectedId]);
  const contactCount = issues.filter((i) => i.requiresClientContact).length;
  const plan = useMemo(() => analysis?.resolutionPlan ?? [], [analysis]);
  const fieldCount = useMemo(() => new Set(plan.flatMap((p) => p.fieldsAffected.map((f) => `${f.document}|${f.field}`))).size, [plan]);
  const docCount = useMemo(() => new Set(plan.flatMap((p) => p.fieldsAffected.map((f) => f.document))).size, [plan]);
  const checklist = useMemo(() => analysis?.evidenceChecklist ?? [], [analysis]);
  const missingCount = checklist.filter((e) => e.status !== "present").length;

  if (!analysis) return null;

  const statusOf = (i: Issue) => {
    if (!i.requiresClientContact) return "skipped" as const;
    return clarifications.find((c) => c.issueId === i.id)?.status ?? ("open" as const);
  };

  return (
    <div className="fade-up">
      {/* Caption block: the matter on the left, the docket details on the right, closed by a double rule. */}
      <div className="caption mb-6 grid gap-6 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <h1 className="page-title">{analysis.caseSummary.clientName}</h1>
          <div className="mt-1 text-[14px] text-ink-2">{analysis.caseSummary.caseType}</div>
          <p className="mt-4 max-w-[72ch] text-[13.5px] leading-relaxed text-ink-2">{analysis.caseSummary.summary}</p>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between lg:w-[320px] lg:flex-col lg:items-stretch lg:border-l lg:border-border lg:pl-6">
          <dl className="caption-table">
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
            <dt>Documents</dt>
            <dd>{documents.length} in the file</dd>
            <dt>Issues</dt>
            <dd>
              {issues.length} found, <span className={cx(contactCount > 0 && "text-amber")}>{contactCount} need the client</span>
            </dd>
            {checklist.length > 0 && (
              <>
                <dt>Evidence</dt>
                <dd>{missingCount === 0 ? "File is complete for this case type" : <span className="text-amber">{missingCount} gap{missingCount === 1 ? "" : "s"} in the file</span>}</dd>
              </>
            )}
            {fieldCount > 0 && (
              <>
                <dt>Fields</dt>
                <dd>
                  {fieldCount} affected across {docCount} document{docCount === 1 ? "" : "s"}
                </dd>
              </>
            )}
          </dl>
          <div className="sm:w-[300px] lg:w-full">
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
                <Button size="lg" className="w-full" onClick={() => router.push("/call?start=browser")} disabled={contactCount === 0} icon={<PhoneCall size={16} />}>
                  Call the client about {contactCount} issue{contactCount === 1 ? "" : "s"}
                </Button>
                {phoneConfigured && (
                  <Button variant="ghost" className="mt-1.5 w-full" onClick={() => router.push("/call?start=phone")} disabled={contactCount === 0} icon={<Smartphone size={14} />}>
                    Call their phone
                  </Button>
                )}
              </>
            )}
            {callState === "ended" && (
              <div className="mt-1.5 text-center text-[11.5px] text-ink-3">{pkg ? "Review, edit and sign off on each correction" : "Builds the correction package from the call"}</div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-1 border-b border-border">
        {(["issues", "plan", "completeness", "facts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium", tab === t ? "border-navy text-navy" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t === "issues"
              ? `Issues (${issues.length})`
              : t === "plan"
                ? `Resolution plan (${plan.length})`
                : t === "completeness"
                  ? `Completeness (${missingCount} gap${missingCount === 1 ? "" : "s"})`
                  : `Extracted facts (${analysis.facts.length})`}
          </button>
        ))}
      </div>

      {tab === "facts" ? (
        <FactsTable />
      ) : tab === "plan" ? (
        <PlanView plan={plan} issues={issues} />
      ) : tab === "completeness" ? (
        <CompletenessView checklist={checklist} />
      ) : issues.length === 0 ? (
        <Card className="text-center text-sm text-ink-2">No inconsistencies were found across these documents.</Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          {/* Issue list */}
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {issues.map((i, idx) => {
              const active = selected?.id === i.id;
              return (
                <button
                  key={i.id}
                  onClick={() => setSelectedId(i.id)}
                  className={cx(
                    "w-full border-l-2 bg-surface p-3.5 text-left transition-colors",
                    active ? "border-l-navy bg-surface shadow-[0_0_0_1px_var(--rule-strong)]" : "border-l-transparent hover:bg-surface-2",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="figure text-[11px] text-ink-3">{idx + 1}.</span>
                    <KindChip kind={i.kind} />
                    <SeverityChip severity={i.severity} />
                    <span className="ml-auto">
                      <ClarificationStatusChip status={statusOf(i)} />
                    </span>
                  </div>
                  <div className={cx("serif mt-2 text-[15px] leading-snug", active ? "text-navy" : "text-ink")}>{i.title}</div>
                  <div className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-2">{i.summary}</div>
                  <div className="mt-2 flex items-center gap-1 text-[11.5px] text-ink-3">
                    <FileSearch size={12} /> {i.evidence.length} passage{i.evidence.length === 1 ? "" : "s"} in {new Set(i.evidence.map((e) => e.docId)).size} document{new Set(i.evidence.map((e) => e.docId)).size === 1 ? "" : "s"}
                    {(() => {
                      const n = plan.find((p) => p.issueId === i.id)?.fieldsAffected.length ?? 0;
                      return n > 0 ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-navy">
                          <FileEdit size={12} /> affects {n} field{n === 1 ? "" : "s"}
                        </span>
                      ) : null;
                    })()}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Issue detail */}
          {selected && <IssueDetail issue={selected} status={statusOf(selected)} />}
        </div>
      )}
    </div>
  );
}

function IssueDetail({ issue, status }: { issue: Issue; status: "open" | "skipped" | "resolved" | "partial" | "unresolved" }) {
  const clarification = useCase((s) => s.clarifications.find((c) => c.issueId === issue.id));
  const step = useCase((s) => s.analysis?.resolutionPlan?.find((p) => p.issueId === issue.id));
  return (
    <Card className="fade-up" key={issue.id}>
      <div className="flex flex-wrap items-center gap-2">
        <KindChip kind={issue.kind} />
        <SeverityChip severity={issue.severity} />
        <ClarificationStatusChip status={status} />
      </div>
      <h2 className="serif mt-3 text-[21px] leading-tight text-navy">{issue.title}</h2>
      <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed text-ink-2">{issue.summary}</p>

      <div className="mt-5 grid gap-5 md:grid-cols-[1fr_1fr]">
        <div>
          <SectionLabel className="mb-2">Why this was flagged</SectionLabel>
          <p className="text-[13px] leading-relaxed text-ink-2">{issue.whyFlagged}</p>
        </div>
        <div>
          <SectionLabel className="mb-2">What needs to be settled</SectionLabel>
          <p className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
            <HelpCircle size={15} className="mt-0.5 shrink-0 text-navy" />
            {issue.needToKnow}
          </p>
        </div>
      </div>

      {issue.possibleExplanation && (
        <div className="mt-5 flex gap-3 rounded-md border border-blue/25 bg-blue-soft p-3.5">
          <Lightbulb size={16} className="mt-0.5 shrink-0 text-blue" />
          <div>
            <div className="text-[12px] font-semibold text-blue">Possible explanation already in the file</div>
            <div className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{issue.possibleExplanation}</div>
          </div>
        </div>
      )}

      <div className="mt-5">
        <SectionLabel className="mb-2" meta={`${issue.evidence.length} passage${issue.evidence.length === 1 ? "" : "s"}`}>Source evidence</SectionLabel>
        <div className="grid gap-2 md:grid-cols-2">
          {issue.evidence.map((e, i) => (
            <EvidenceCard key={i} e={e} />
          ))}
        </div>
      </div>

      {step && (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-navy/25 bg-navy-soft/50 p-3.5">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-navy">
              <FileEdit size={14} /> Downstream impact, {step.fieldsAffected.length} field{step.fieldsAffected.length === 1 ? "" : "s"}
            </div>
            {step.fieldsAffected.length === 0 ? (
              <div className="mt-1.5 text-[12.5px] text-ink-3">No form fields change until this is resolved.</div>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {step.fieldsAffected.map((f, k) => (
                  <li key={k} className="text-[12.5px] text-ink">
                    <span className="font-medium">{f.document}</span> <span className="text-ink-3">›</span> {f.field}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border border-border bg-surface-2 p-3.5">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
              <ListChecks size={14} /> {step.approach === "ask_client" ? "On the call" : step.approach === "request_document" ? "Document to request" : "Attorney confirms from file"}
            </div>
            <div className="mt-1.5 text-[12.5px] text-ink">{step.objective}</div>
            {issue.requiresClientContact && <p className="serif mt-2 text-[14px] italic leading-relaxed text-ink">“{issue.suggestedQuestion}”</p>}
            {step.ifUnclear && (
              <div className="mt-1.5 text-[12px] text-ink-2">
                <span className="font-medium">If unclear:</span> {step.ifUnclear}
              </div>
            )}
            {step.documentsThatWouldHelp.length > 0 && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[12px] text-ink-2">
                <Paperclip size={12} className="mt-0.5 shrink-0" /> Would settle it: {step.documentsThatWouldHelp.join("; ")}
              </div>
            )}
          </div>
        </div>
      )}

      {!step && issue.requiresClientContact && (
        <div className="mt-5 rounded-md border border-border bg-surface-2 p-3.5">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
            <MessageSquareQuote size={14} /> On the call
          </div>
          <p className="serif mt-1.5 text-[14px] italic leading-relaxed text-ink">“{issue.suggestedQuestion}”</p>
        </div>
      )}

      {clarification && (
        <div className="mt-5 rounded-md border border-green/25 bg-green-soft p-3.5">
          <SectionLabel meta={clarification.status}>Client clarification</SectionLabel>
          <p className="mt-1 text-[13px] text-ink">{clarification.clientStatement}</p>
          {clarification.findings.length > 0 && (
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-2">
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
    </Card>
  );
}

function PlanView({ plan, issues }: { plan: PlanStep[]; issues: Issue[] }) {
  const clarifications = useCase((s) => s.clarifications);
  if (plan.length === 0) return <Card className="text-center text-sm text-ink-2">No resolution plan was produced for this analysis.</Card>;
  const icon = (a: PlanStep["approach"]) => (a === "ask_client" ? <PhoneCall size={14} /> : a === "request_document" ? <Paperclip size={14} /> : <UserCheck size={14} />);
  const label = (a: PlanStep["approach"]) => (a === "ask_client" ? "Ask the client on the call" : a === "request_document" ? "Request a document from the client" : "Attorney confirms from the file");
  const allFields = plan.flatMap((p) => p.fieldsAffected.map((f) => ({ ...f, issueId: p.issueId })));
  const byDoc = new Map<string, typeof allFields>();
  for (const f of allFields) byDoc.set(f.document, [...(byDoc.get(f.document) ?? []), f]);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {plan.map((p, idx) => {
          const issue = issues.find((i) => i.id === p.issueId);
          const c = clarifications.find((x) => x.issueId === p.issueId);
          return (
            <Card key={p.issueId} className="flex gap-4">
              <span className="figure serif grid h-7 w-7 shrink-0 place-items-center rounded-full border border-navy text-[13px] text-navy">{idx + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="serif text-[15.5px] text-ink">{issue?.title ?? p.issueId}</span>
                  <Chip tone={p.approach === "ask_client" ? "navy" : "neutral"}>
                    {icon(p.approach)} {label(p.approach)}
                  </Chip>
                  {c && <ClarificationStatusChip status={c.status} />}
                </div>
                <div className="mt-1.5 text-[13px] text-ink">{p.objective}</div>
                {p.askFirst && (
                  <div className="mt-2 text-[13px] text-ink-2">
                    <span className="text-ink-3">Opens with: </span><span className="serif italic text-ink">“{p.askFirst}”</span>
                  </div>
                )}
                {p.ifUnclear && (
                  <div className="mt-1.5 text-[12.5px] text-ink-2">
                    <span className="font-medium text-ink-3">If unclear: </span>
                    {p.ifUnclear}
                  </div>
                )}
                {p.documentsThatWouldHelp.length > 0 && (
                  <div className="mt-1.5 text-[12.5px] text-ink-2">
                    <span className="font-medium text-ink-3">Would settle it: </span>
                    {p.documentsThatWouldHelp.join("; ")}
                  </div>
                )}
                {(p.followUps ?? []).length > 0 && (
                  <div className="mt-2 rounded-md border border-amber/25 bg-amber-soft/60 p-2.5">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber">
                      <CircleHelp size={12} /> Once settled, the agent goes one level deeper
                    </div>
                    <ul className="mt-1 space-y-1">
                      {p.followUps.map((q, k) => (
                        <li key={k} className="serif text-[13px] italic text-ink-2">
                          “{q}”
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.fieldsAffected.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.fieldsAffected.map((f, k) => (
                      <span key={k} className="rounded border border-navy/20 bg-navy-soft px-1.5 py-0.5 text-[11px] text-navy">
                        {f.document} › {f.field}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card padded={false}>
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <FileEdit size={14} className="text-navy" />
            <SectionLabel meta={`${allFields.length} field${allFields.length === 1 ? "" : "s"}`}>Downstream impact</SectionLabel>
          </div>
          {[...byDoc.entries()].map(([doc, fields]) => (
            <div key={doc} className="border-b border-border px-4 py-3 last:border-b-0">
              <div className="text-[12.5px] font-semibold">{doc}</div>
              <ul className="mt-1 space-y-0.5">
                {fields.map((f, k) => (
                  <li key={k} className="flex items-baseline gap-2 text-[12px] text-ink-2">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-navy" />
                    <span>{f.field}</span>
                    <span className="figure ml-auto shrink-0 text-[11px] text-ink-3">step {plan.findIndex((p) => p.issueId === f.issueId) + 1}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function CompletenessView({ checklist }: { checklist: EvidenceCheck[] }) {
  const clarifications = useCase((s) => s.clarifications);
  if (checklist.length === 0) return <Card className="text-center text-sm text-ink-2">No evidence checklist was produced for this analysis.</Card>;
  const groups: Array<[string, EvidenceCheck[]]> = [
    ["Missing", checklist.filter((e) => e.status === "missing")],
    ["Unclear", checklist.filter((e) => e.status === "unclear")],
    ["Present", checklist.filter((e) => e.status === "present")],
  ];
  return (
    <div className="space-y-4">
      {groups.map(([label, items]) =>
        items.length === 0 ? null : (
          <Card key={label} padded={false}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <SectionLabel>{label}</SectionLabel>
              <Chip tone={label === "Missing" ? "red" : label === "Unclear" ? "amber" : "green"}>{items.length}</Chip>
            </div>
            <ul className="divide-y divide-border">
              {items.map((e) => {
                const c = clarifications.find((x) => x.issueId === `evidence:${e.item}`);
                return (
                  <li key={e.item} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium">{e.item}</span>
                      {e.foundIn && <Chip tone="green">{e.foundIn}</Chip>}
                      {e.askClient && e.status !== "present" && <Chip tone="navy"><PhoneCall size={11} /> Asked on the call</Chip>}
                      {c && <ClarificationStatusChip status={c.status} />}
                    </div>
                    <div className="mt-1 text-[12.5px] text-ink-2">{e.why}</div>
                    {e.askClient && e.question && <div className="serif mt-1 text-[13px] italic text-ink-2">“{e.question}”</div>}
                    {c && (
                      <div className="mt-1 text-[12px] text-ink">
                        <span className="font-medium">Client: </span>
                        {c.clientStatement}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ),
      )}
    </div>
  );
}

function FactsTable() {
  const facts = useCase((s) => s.analysis?.facts ?? []);
  const groups = useMemo(() => {
    const m = new Map<string, typeof facts>();
    for (const f of facts) m.set(f.category, [...(m.get(f.category) ?? []), f]);
    return [...m.entries()];
  }, [facts]);
  return (
    <div className="space-y-4">
      {groups.map(([cat, list]) => (
        <Card key={cat} padded={false}>
          <div className="border-b border-border px-4 py-2.5">
            <SectionLabel>{cat}</SectionLabel>
          </div>
          <table className="w-full text-[12.5px]">
            <tbody className="divide-y divide-border">
              {list.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className="w-[220px] px-4 py-2.5 text-ink-2">{f.label}</td>
                  <td className="w-[260px] px-4 py-2.5 font-medium">{f.value}</td>
                  <td className="px-4 py-2.5">
                    <EvidenceCard e={f.evidence} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
