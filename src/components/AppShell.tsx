"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Check, RotateCcw } from "lucide-react";
import { useCase } from "@/lib/store";
import { cx } from "@/components/ui";

const STEPS = [
  { href: "/", label: "Upload", n: 1 },
  { href: "/case", label: "Issues", n: 2 },
  { href: "/call", label: "Client call", n: 3 },
  { href: "/review", label: "Review & sign-off", n: 4 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const setEngine = useCase((s) => s.setEngine);
  const documents = useCase((s) => s.documents);
  const analysis = useCase((s) => s.analysis);
  const callState = useCase((s) => s.callState);
  const pkg = useCase((s) => s.pkg);
  const signOff = useCase((s) => s.signOff);
  const resetAll = useCase((s) => s.resetAll);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setEngine)
      .catch(() => setEngine({ live: false, model: "local-rules", label: "Demo mode", voice: "browser", transcription: false, phone: { configured: false, to: null, from: null, publicUrl: null } }));
  }, [setEngine]);

  const reached = [true, !!analysis, callState !== "idle" || !!pkg, !!pkg];
  const done = [documents.length > 0 && !!analysis, !!analysis && callState === "ended", callState === "ended" && !!pkg, !!signOff];
  const active = STEPS.findIndex((s) => s.href === pathname);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-surface">
        <div className="mx-auto flex h-[60px] max-w-[1240px] items-center gap-6 px-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center border border-navy text-navy outline outline-1 outline-offset-2 outline-navy/40">
              <span className="serif text-[13px] leading-none">S</span>
            </span>
            <span className="serif whitespace-nowrap text-[19px] leading-none text-navy">Sharma Resolve</span>
          </Link>

          <nav className="ml-4 hidden items-center md:flex" aria-label="Workflow">
            {STEPS.map((s, i) => {
              const isActive = i === active;
              const isDone = hydrated && done[i];
              const enabled = hydrated && reached[i];
              return (
                <div key={s.href} className="flex items-center">
                  {i > 0 && <span className="mx-2.5 h-px w-5 bg-border-strong" />}
                  <button
                    onClick={() => enabled && router.push(s.href)}
                    disabled={!enabled}
                    aria-current={isActive ? "step" : undefined}
                    className={cx(
                      "flex items-center gap-2 rounded-sm px-1.5 py-1 text-[13px] transition-colors",
                      isActive ? "text-navy font-semibold" : enabled ? "text-ink-2 hover:text-ink" : "text-ink-3/70 cursor-default",
                    )}
                  >
                    <span
                      className={cx(
                        "figure grid h-5 w-5 place-items-center rounded-full border text-[10.5px] font-semibold",
                        isDone ? "border-green bg-green text-white" : isActive ? "border-navy bg-navy text-white" : "border-border-strong text-ink-3",
                      )}
                    >
                      {isDone ? <Check size={11} strokeWidth={3} /> : s.n}
                    </span>
                    {s.label}
                  </button>
                </div>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {hydrated && documents.length > 0 && (
              <button
                onClick={() => {
                  if (confirm("Close this case and start a new one? The uploaded documents, analysis, call and corrections will be cleared.")) {
                    resetAll();
                    router.push("/");
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12.5px] text-ink-3 hover:bg-surface-2 hover:text-ink"
                title="Close this case and start a new one"
              >
                <RotateCcw size={13} /> New case
              </button>
            )}
          </div>
        </div>
        {/* Double rule beneath the masthead */}
        <div className="border-b border-border-strong" />
        <div className="mt-[3px] border-b border-border-strong" />
      </header>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 py-7">{hydrated ? children : null}</main>
      <footer className="mx-auto w-full max-w-[1240px] px-5 py-5 text-[11.5px] leading-relaxed text-ink-3">
        <div className="border-t border-border pt-4">
          Attorney work product. Privileged and confidential.
        </div>
      </footer>
    </div>
  );
}
