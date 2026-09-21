"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mic, MicOff, PhoneCall, PhoneOff, Send, Volume2, VolumeX, ArrowRight, RotateCcw, AlertCircle, Bot, User, Headphones, Keyboard, Smartphone, Globe, BrainCircuit, ChevronDown } from "lucide-react";
import { useCase, newId } from "@/lib/store";
import { clientPhoneFromFacts } from "@/lib/contact";
import type { Clarification, ConverseResponse, Issue, TranscriptTurn } from "@/lib/types";
import { primeVoices, Recognizer, RemoteRecorder, speak, speakRemote, stopRemoteSpeaking, stopSpeaking, supportsSTT, supportsTTS } from "@/lib/voice";
import { Button, Card, Chip, ClarificationStatusChip, SectionLabel, Spinner, cx } from "@/components/ui";

type Phase = "precall" | "active" | "phone" | "ended";

type AgentState = "idle" | "thinking" | "speaking" | "listening";

export default function CallPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <CallSession />
    </Suspense>
  );
}

function CallSession() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const analysis = useCase((s) => s.analysis);
  const engine = useCase((s) => s.engine);
  const callState = useCase((s) => s.callState);
  const clarifications = useCase((s) => s.clarifications);
  const pkg = useCase((s) => s.pkg);

  // Arriving with `?start=` (from the Issues page) always begins a new call, even after an earlier one ended.
  const [phase, setPhase] = useState<Phase>(callState === "ended" && !searchParams.get("start") ? "ended" : "precall");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [currentSpeech, setCurrentSpeech] = useState("");
  const [focusIssueId, setFocusIssueId] = useState<string | null>(null);
  // Capability detection runs on the client only (the shell renders children after hydration).
  const remoteAvailable = engine?.voice === "elevenlabs";
  const [remote, setRemote] = useState<boolean | null>(null); // null = follow server capability
  const useRemote = remote ?? remoteAvailable;
  // Transcription can be unavailable even when natural voice output is (a key without that permission,
  // or a provider failure mid-call); the browser's recogniser is used for input in that case.
  const [remoteInFailed, setRemoteInFailed] = useState(false);
  const useRemoteIn = useRemote && engine?.transcription !== false && !remoteInFailed;
  const micAvailable = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const [ttsAvailable] = useState(() => supportsTTS());
  const [sttAvailable, setSttAvailable] = useState(() => supportsSTT());
  const [voiceOut, setVoiceOut] = useState(() => supportsTTS());
  const [voiceIn, setVoiceIn] = useState(() => supportsSTT());
  const [level, setLevel] = useState(0);
  // With natural voice available, the toggles default on even if the browser lacks Web Speech.
  const voiceOutEffective = voiceOut || (useRemote && remote === null && !ttsAvailable);
  const voiceInEffective = voiceIn || (useRemoteIn && remote === null && !sttAvailable && micAvailable);
  const canSpeak = ttsAvailable || useRemote;
  const canListen = useRemoteIn ? micAvailable : sttAvailable;
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [phoneSession, setPhoneSession] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<string[]>([]);
  const [showReasoning, setShowReasoning] = useState(true);
  const [phoneStatus, setPhoneStatus] = useState<string>("queued");
  const [phoneTo, setPhoneTo] = useState("");
  // Chosen on the Issues page: `?start=phone` dials the client; anything else is a browser session.
  // Read via the router (not window.location, which still points at the previous page during the first render).
  const [startMode, setStartMode] = useState<"browser" | "phone">(() => (searchParams.get("start") === "phone" ? "phone" : "browser"));
  const phoneSeen = useRef<Set<string>>(new Set());

  const recognizer = useRef<Recognizer | null>(null);
  const recorder = useRef<RemoteRecorder | null>(null);
  const useRemoteRef = useRef(useRemote);
  const useRemoteInRef = useRef(useRemoteIn);
  const voiceOutRef = useRef(voiceOut);
  const voiceInRef = useRef(voiceIn);
  const phaseRef = useRef(phase);
  const busyRef = useRef(false);
  const clientSaidRef = useRef<(text: string) => Promise<void>>(async () => {});
  const focusRef = useRef<string | null>(null);
  useEffect(() => {
    voiceOutRef.current = voiceOutEffective;
    voiceInRef.current = voiceInEffective;
    phaseRef.current = phase;
    useRemoteRef.current = useRemote;
    useRemoteInRef.current = useRemoteIn;
  }, [voiceOutEffective, voiceInEffective, phase, useRemote, useRemoteIn]);

  useEffect(() => {
    if (!analysis) router.replace("/");
  }, [analysis, router]);

  useEffect(() => {
    if (supportsTTS()) primeVoices();
    return () => {
      stopSpeaking();
      stopRemoteSpeaking();
      recognizer.current?.stop();
      recorder.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (phase !== "active" && phase !== "phone") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const plan = analysis?.resolutionPlan ?? [];
  const planRank = new Map(plan.map((p, i) => [p.issueId, i]));
  const issues: Issue[] = (analysis?.issues.filter((i) => i.requiresClientContact) ?? []).slice().sort((a, b) => (planRank.get(a.id) ?? 999) - (planRank.get(b.id) ?? 999));

  // ---------- listening ----------
  const stopListening = useCallback((deliver = false) => {
    recognizer.current?.stop(deliver);
    recognizer.current = null;
    if (deliver) recorder.current?.stop();
    else recorder.current?.cancel();
    recorder.current = null;
    setInterim("");
    setLevel(0);
  }, []);

  const startListening = useCallback(() => {
    if (!voiceInRef.current || phaseRef.current !== "active") {
      setAgentState("idle");
      return;
    }
    stopListening();
    if (useRemoteInRef.current) {
      const r = new RemoteRecorder({
        onLevel: setLevel,
        onFinal: (t) => void clientSaidRef.current(t),
        onError: (msg) => {
          setLevel(0);
          if (/No speech detected/.test(msg)) {
            setAgentState("idle");
            return;
          }
          if (/Microphone access/.test(msg)) {
            setVoiceIn(false);
            setNotice(msg);
            setAgentState("idle");
            return;
          }
          // Provider failure: drop back to the browser recognizer for the rest of the call (voice output is unaffected).
          setRemoteInFailed(true);
          setNotice(`Voice input unavailable (${msg}). Using device speech recognition.`);
          setAgentState("idle");
        },
        onEnd: () => setAgentState((s) => (s === "listening" ? "idle" : s)),
      });
      recorder.current = r;
      setAgentState("listening");
      void r.start().then((ok) => {
        if (!ok) setAgentState("idle");
      });
      return;
    }
    const rec = new Recognizer({
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim("");
        void clientSaidRef.current(t);
      },
      onError: (msg) => {
        setInterim("");
        if (/No speech detected/.test(msg)) {
          // Keep listening quietly; the client may just be thinking.
          setAgentState("idle");
          return;
        }
        setVoiceIn(false);
        setSttAvailable(false);
        setNotice(msg);
        setAgentState("idle");
      },
      onEnd: () => {
        setAgentState((s) => (s === "listening" ? "idle" : s));
      },
    });
    recognizer.current = rec;
    if (rec.start()) setAgentState("listening");
  }, [stopListening]);

  const endCall = useCallback(
    (byUser: boolean) => {
      stopSpeaking();
      stopRemoteSpeaking();
      stopListening();
      setPhase("ended");
      phaseRef.current = "ended";
      setAgentState("idle");
      const st = useCase.getState();
      st.appendTranscript({ id: newId("t"), role: "system", text: byUser ? "Call ended by case manager." : "Call completed.", ts: new Date().toISOString() });
      st.setCallState("ended");
    },
    [stopListening],
  );

  // ---------- one agent turn ----------
  const agentTurn = useCallback(
    async (clientUtterance: string | null, event?: { type: "document_received"; docName: string; excerpt: string }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError(null);
      setAgentState("thinking");
      setReasoning([]);
      const st = useCase.getState();
      try {
        const res = await fetch("/api/converse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            caseSummary: st.analysis!.caseSummary,
            issues: st.analysis!.issues,
            plan: st.analysis!.resolutionPlan ?? [],
            evidenceChecklist: st.analysis!.evidenceChecklist ?? [],
            clarifications: st.clarifications,
            transcript: st.transcript,
            clientUtterance,
            event,
          }),
        });
        const data = (await res.json()) as ConverseResponse & { error?: string };
        if (!res.ok) throw new Error(data.error || "The agent could not respond.");
        for (const u of data.updates) st.upsertClarification(u);
        st.appendTranscript({ id: newId("t"), role: "agent", text: data.speech, ts: new Date().toISOString(), issueId: data.focusIssueId, reasoning: data.reasoning });
        setReasoning(data.reasoning ?? []);
        setFocusIssueId(data.focusIssueId);
        focusRef.current = data.focusIssueId;
        setCurrentSpeech(data.speech);
        setAgentState("speaking");
        if (voiceOutRef.current && phaseRef.current === "active") {
          if (useRemoteRef.current) {
            try {
              await speakRemote(data.speech);
            } catch (e) {
              if (phaseRef.current === "active") {
                setNotice(`Voice output unavailable (${e instanceof Error ? e.message : "error"}). Using device voice.`);
                setRemote(false);
                await speak(data.speech);
              }
            }
          } else {
            await speak(data.speech);
          }
        }
        if (data.endCall) {
          endCall(false);
          return;
        }
        if (phaseRef.current !== "active") return;
        if (voiceInRef.current) startListening();
        else setAgentState("idle");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setAgentState("idle");
      } finally {
        busyRef.current = false;
      }
    },
    [startListening, endCall],
  );

  const clientSaid = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || phaseRef.current !== "active" || busyRef.current) return;
      stopListening();
      stopSpeaking();
      stopRemoteSpeaking();
      useCase.getState().appendTranscript({ id: newId("t"), role: "client", text: t, ts: new Date().toISOString(), issueId: focusRef.current });
      await agentTurn(t);
    },
    [agentTurn, stopListening],
  );
  useEffect(() => {
    clientSaidRef.current = clientSaid;
  }, [clientSaid]);

  const publicOk = !!engine?.phone.publicUrl || (typeof location !== "undefined" && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname));

  /** Place a real phone call; the server runs the same conversation engine and we mirror its state. */
  const startPhoneCall = async () => {
    const st = useCase.getState();
    if (st.callState === "ended" || st.transcript.length) st.resetCall();
    setError(null);
    setNotice(null);
    phoneSeen.current = new Set();
    try {
      const res = await fetch("/api/phone/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseSummary: st.analysis!.caseSummary, issues: st.analysis!.issues, plan: st.analysis!.resolutionPlan ?? [], evidenceChecklist: st.analysis!.evidenceChecklist ?? [], to: phoneTo || clientPhoneFromFacts(st.analysis!.facts)?.e164 || undefined }),
      });
      const data = (await res.json()) as { sessionId?: string; to?: string; error?: string };
      if (!res.ok || !data.sessionId) throw new Error(data.error || "Could not place the call.");
      st.setCallState("active");
      setPhoneSession(data.sessionId);
      setPhoneStatus("queued");
      setPhoneTo(data.to ?? "");
      setElapsed(0);
      setPhase("phone");
      phaseRef.current = "phone";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (phase !== "phone" || !phoneSession) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/phone/state?s=${phoneSession}`);
        if (!res.ok) return;
        const v = (await res.json()) as { status: string; transcript: TranscriptTurn[]; clarifications: Clarification[]; focusIssueId: string | null; ended: boolean; error?: string };
        if (stop) return;
        const st = useCase.getState();
        setPhoneStatus(v.status);
        for (const t of v.transcript) {
          if (phoneSeen.current.has(t.id)) continue;
          phoneSeen.current.add(t.id);
          st.appendTranscript(t);
          if (t.role === "agent") {
            setCurrentSpeech(t.text);
            setReasoning(t.reasoning ?? []);
          }
        }
        const prev = st.clarifications;
        for (const c of v.clarifications) {
          const before = prev.find((x) => x.issueId === c.issueId);
          if (!before || before.updatedAt !== c.updatedAt) {
            st.upsertClarification(c);
          }
        }
        if (v.focusIssueId !== focusRef.current) {
          focusRef.current = v.focusIssueId;
          setFocusIssueId(v.focusIssueId);
        }
        if (v.error) setNotice(`Agent turn error (recovered): ${v.error}`);
        if (v.ended) {
          stop = true;
          setPhase("ended");
          phaseRef.current = "ended";
          st.setCallState("ended");
          setAgentState("idle");
        }
      } catch {
        /* transient */
      }
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [phase, phoneSession]);

  const hangupPhone = async () => {
    if (!phoneSession) return;
    await fetch("/api/phone/hangup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: phoneSession }) }).catch(() => null);
  };

  const startCall = async () => {
    const st = useCase.getState();
    if (st.callState === "ended" || st.transcript.length) st.resetCall();
    st.setCallState("active");
    setPhase("active");
    phaseRef.current = "active";
    setElapsed(0);
    setNotice(null);
    setError(null);
    if (voiceOutEffective && supportsTTS() && !useRemote) {
      // A user gesture has just happened; a silent utterance unlocks speech on strict browsers.
      await speak(" ");
    }
    await agentTurn(null);
  };

  const onMicClick = () => {
    if (agentState === "listening") {
      stopListening(true);
      return;
    }
    if (agentState === "thinking") return;
    stopSpeaking();
    stopRemoteSpeaking();
    setVoiceIn(true);
    voiceInRef.current = true;
    startListening();
  };

  const submitTyped = () => {
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    void clientSaid(t);
  };

  // Opened from the Issues page: begin immediately once capability status is known.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!analysis || !engine || phase !== "precall" || startedRef.current) return;
    // Kick off on the next tick: the start functions drive state and network, not this render.
    // The guard is set inside the callback so a cancelled timer (StrictMode re-runs) doesn't count as started.
    const t = setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      window.history.replaceState(null, "", "/call");
      void (startMode === "phone" ? startPhoneCall() : startCall());
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, engine, phase]);

  const generatePackage = async () => {
    setGenerating(true);
    setError(null);
    const st = useCase.getState();
    try {
      const res = await fetch("/api/package", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseSummary: st.analysis!.caseSummary,
          issues: st.analysis!.issues,
          clarifications: st.clarifications,
          transcript: st.transcript,
          callDocuments: st.documents.filter((d) => d.receivedDuringCall).map((d) => ({ name: d.name, excerpt: d.text.slice(0, 6000) })),
          evidenceChecklist: st.analysis!.evidenceChecklist ?? [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate the correction package.");
      st.setPackage(data);
      router.push("/review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  if (!analysis) return null;

  const clientName = analysis.caseSummary.clientName;
  const firstName = clientName.split(" ")[0];
  const filePhone = clientPhoneFromFacts(analysis.facts);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const live = engine?.live ?? false;

  // ---------- pre-call: the call starts as soon as the page opens ----------
  if (phase === "precall") {
    return (
      <div className="fade-up mx-auto max-w-xl">
        <Card>
          <div className="flex items-center gap-3">
            {!error && <Spinner className="text-navy" />}
            <div>
              <div className="serif text-[17px] text-ink">{startMode === "phone" ? `Calling ${clientName}` : `Starting the call with ${clientName}`}</div>
              {startMode === "phone" && filePhone && (
                <div className="mt-0.5 text-[12.5px] text-ink-2">Dialing the number on file, from {filePhone.docName.replace(/\.(pdf|docx|txt)$/i, "").replace(/_/g, " ")}</div>
              )}
            </div>
          </div>
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red/30 bg-red-soft px-3 py-2 text-[12.5px] text-red">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {error && startMode === "phone" && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input
                value={phoneTo || engine?.phone.to || ""}
                onChange={(e) => setPhoneTo(e.target.value)}
                placeholder="+1…"
                className="h-9 w-48 rounded border border-border bg-surface px-2.5 font-mono text-[13px] outline-none focus:border-navy"
              />
              <Button onClick={startPhoneCall} icon={<Smartphone size={15} />} disabled={!publicOk}>
                Call this number
              </Button>
              <Button variant="ghost" onClick={() => { setError(null); setStartMode("browser"); void startCall(); }}>
                Use browser voice instead
              </Button>
              {!publicOk && (
                <span className="flex items-center gap-1 text-[12px] text-amber">
                  <Globe size={12} /> Phone calls need the app served from a public address.
                </span>
              )}
            </div>
          )}
          {error && startMode !== "phone" && (
            <div className="mt-4 flex gap-2">
              <Button onClick={() => { setError(null); void startCall(); }} icon={<PhoneCall size={15} />}>
                Try again
              </Button>
              <Button variant="ghost" onClick={() => router.push("/case")}>
                Back to issues
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // ---------- active / ended ----------
  return (
    <div className="fade-up grid gap-5 lg:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <Card padded={false} className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3">
            <div className={cx("relative h-2.5 w-2.5 rounded-full", phase === "active" || phase === "phone" ? "bg-green" : "bg-ink-3")}>
              {(phase === "active" || phase === "phone") && <span className="pulse-ring absolute inset-0 text-green" />}
            </div>
            <div className="serif text-[15px] text-ink">
              {phase === "active" ? "Live voice session" : phase === "phone" ? "Phone call" : "Call ended"} with {clientName}
            </div>
            <span className="figure text-[12.5px] text-ink-3">
              {mm}:{ss}
            </span>
          </div>

          <div className="flex min-h-[340px] flex-col items-center justify-center px-6 py-8 text-center">
            <div className={cx("relative grid h-20 w-20 place-items-center rounded-full", agentState === "speaking" ? "bg-navy text-white" : "bg-navy-soft text-navy")}>
              {agentState === "speaking" && <span className="pulse-ring absolute inset-0 text-navy" />}
              {agentState === "thinking" ? <Spinner className="h-6 w-6" /> : <Bot size={30} />}
            </div>
            <div className="mt-3 text-[12.5px] font-medium text-ink-3">
              {phase === "phone" && (phoneStatus === "queued" ? "Dialing…" : phoneStatus === "ringing" ? "Ringing…" : "Connected — on the phone")}
              {phase !== "phone" && agentState === "thinking" && "Interpreting…"}
              {phase !== "phone" && agentState === "speaking" && "Agent speaking"}
              {phase !== "phone" && agentState === "listening" && "Listening to client"}
              {phase !== "phone" && agentState === "idle" && phase === "active" && "Waiting for client"}
              {phase === "ended" && "Session complete"}
            </div>
            {agentState === "listening" && (
              <div className="eq mt-2 text-green" style={useRemoteIn ? { opacity: 0.35 + level * 0.65, transform: `scaleY(${0.6 + level})` } : undefined}>
                <span /><span /><span /><span /><span />
              </div>
            )}
            <p className="serif mt-4 w-full max-w-[58ch] text-[19px] leading-relaxed text-ink">{currentSpeech || (phase === "ended" ? "The session has ended." : phase === "phone" ? `Calling ${firstName}…` : "Connecting…")}</p>
            {interim && <p className="serif mt-4 w-full max-w-[58ch] text-[15px] italic text-ink-3">“{interim}…”</p>}
            {focusIssueId && (phase === "active" || phase === "phone") && (
              <div className="mt-4">
                <Chip tone="navy">Discussing: {focusIssueId.startsWith("evidence:") ? `Evidence — ${focusIssueId.slice(9)}` : issues.find((i) => i.id === focusIssueId)?.title}</Chip>
              </div>
            )}
          </div>

          {(
            <div className="mx-5 mb-4 rounded-md border border-border bg-surface-2">
              <button type="button" onClick={() => setShowReasoning((v) => !v)} className="flex w-full items-center gap-2 px-3.5 py-2 text-left">
                <BrainCircuit size={14} className="text-navy" />
                <span className="heading text-[14px]">Agent reasoning</span>
                <span className="text-[11.5px] text-ink-3">how this turn was decided</span>
                {agentState === "thinking" && phase === "active" && <Spinner className="ml-2 h-3 w-3" />}
                <ChevronDown size={14} className={cx("ml-auto text-ink-3 transition-transform", showReasoning ? "" : "-rotate-90")} />
              </button>
              {showReasoning && (
                <ol className="space-y-1.5 border-t border-border px-3.5 py-3 text-left" key={reasoning.join("|")}>
                  {reasoning.length === 0 && (
                    <li className="text-[12.5px] text-ink-3">{agentState === "thinking" ? "Weighing the client's answer against the file…" : "The agent's reasoning for each turn appears here as it decides what to say."}</li>
                  )}
                  {reasoning.map((step, i) => (
                    <li key={i} className="fade-up flex gap-2.5 text-[13px] leading-snug text-ink" style={{ animationDelay: `${i * 220}ms` }}>
                      <span className="figure mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-navy/40 text-[10px] text-navy">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {(notice || error) && (
            <div className={cx("mx-5 mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]", error ? "border-red/30 bg-red-soft text-red" : "border-amber/30 bg-amber-soft text-amber")}>
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error ?? notice}</span>
              {error && phase === "active" && (
                <button onClick={() => void agentTurn(null)} className="shrink-0 rounded border border-red/40 px-2 py-0.5 font-medium hover:bg-red/10">
                  Retry
                </button>
              )}
            </div>
          )}

          {phase === "phone" ? (
            <div className="flex items-center gap-3 border-t border-border bg-surface-2 px-5 py-4">
              <Smartphone size={16} className="text-navy" />
              <div className="text-[12.5px] text-ink-2">The client is on the phone. This screen updates after every turn.</div>
              <Button variant="danger" className="ml-auto" onClick={hangupPhone} icon={<PhoneOff size={15} />}>
                Hang up
              </Button>
            </div>
          ) : phase === "active" ? (
            <div className="border-t border-border bg-surface-2 px-5 py-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={onMicClick}
                  disabled={!canListen || agentState === "thinking"}
                  className={cx(
                    "grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 transition-colors disabled:opacity-40",
                    agentState === "listening" ? "border-green bg-green text-white" : "border-navy bg-surface text-navy hover:bg-navy-soft",
                  )}
                  title={!canListen ? "Speech recognition unavailable" : agentState === "listening" ? "Stop and send" : "Speak as the client"}
                >
                  {canListen ? <Mic size={22} /> : <MicOff size={22} />}
                </button>
                <form
                  className="flex flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitTyped();
                  }}
                >
                  <Keyboard size={15} className="text-ink-3" />
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={agentState === "thinking" ? "Agent is thinking…" : "Or type the client's answer and press Enter"}
                    disabled={agentState === "thinking"}
                    className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
                  />
                  <button type="submit" disabled={!typed.trim() || agentState === "thinking"} className="rounded p-1.5 text-navy hover:bg-navy-soft disabled:opacity-40">
                    <Send size={16} />
                  </button>
                </form>
                <Button variant="danger" onClick={() => endCall(true)} icon={<PhoneOff size={15} />}>
                  End call
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
                <details className="relative ml-auto">
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 hover:text-ink">
                    <Headphones size={13} /> Audio
                  </summary>
                  <div className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-md border border-border bg-surface p-3 text-ink-2 shadow-lg">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={voiceOutEffective} disabled={!canSpeak} onChange={(e) => { setVoiceOut(e.target.checked); if (!e.target.checked) { stopSpeaking(); stopRemoteSpeaking(); } }} />
                      {voiceOut ? <Volume2 size={13} /> : <VolumeX size={13} />} Speak replies aloud
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={voiceInEffective} disabled={!canListen} onChange={(e) => { setVoiceIn(e.target.checked); if (!e.target.checked) stopListening(); }} />
                      <Mic size={13} /> Listen after each question
                    </label>
                    {remoteAvailable && (
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={useRemote} onChange={(e) => { stopSpeaking(); stopRemoteSpeaking(); stopListening(); setRemote(e.target.checked); }} />
                        <Headphones size={13} /> High-quality voice
                      </label>
                    )}
                  </div>
                </details>
              </div>
            </div>
          ) : (
            <div className="border-t border-border bg-surface-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="figure text-[13px] text-ink-2">
                  {clarifications.filter((c) => c.status === "resolved").length} resolved, {clarifications.filter((c) => c.status === "unresolved" || c.status === "partial").length} unresolved,{" "}
                  {issues.filter((i) => !clarifications.some((c) => c.issueId === i.id)).length} not discussed
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => { setCurrentSpeech(""); setFocusIssueId(null); setPhoneSession(null); setReasoning([]); void startCall(); }} icon={<RotateCcw size={14} />}>
                    Call again
                  </Button>
                  {pkg ? (
                    <Button onClick={() => router.push("/review")} icon={<ArrowRight size={15} />}>
                      View correction package
                    </Button>
                  ) : (
                    <Button onClick={generatePackage} disabled={generating} icon={generating ? <Spinner /> : <ArrowRight size={15} />}>
                      {generating ? "Generating package…" : "Generate correction package"}
                    </Button>
                  )}
                </div>
              </div>
              {generating && (
                <div className="mt-3 rounded-md border border-navy/25 bg-surface px-4 py-3 text-[12.5px] text-ink-2">
                  <div className="font-medium text-ink">Turning the call into corrections</div>
                  <div className="mt-1">
                    For each issue: existing evidence → what the client said → proposed change → field-level edits to the DS-160, intake and case record, plus the attorney review email.
                    {live ? " Typically 30–60 seconds." : ""}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card padded={false}>
          <div className="border-b border-border px-5 py-2.5">
            <SectionLabel>Transcript</SectionLabel>
          </div>
          <Transcript />
        </Card>
      </div>

      {/* Agent activity + issue tracker */}
      <div className="space-y-3">
        <Card padded={false}>
          <div className="border-b border-border px-4 py-2.5">
            <SectionLabel>Issues on this call</SectionLabel>
          </div>
          <div className="divide-y divide-border">
          {issues.map((i, idx) => {
          const c = clarifications.find((x) => x.issueId === i.id);
          const active = focusIssueId === i.id && (phase === "active" || phase === "phone");
          return (
            <div key={i.id} className={cx("border-l-2 bg-surface px-3.5 py-3 transition-colors", active ? "border-l-navy" : "border-l-transparent")}>
              <div className="flex items-center gap-2">
                <span className="figure text-[11px] text-ink-3">{idx + 1}.</span>
                <span className={cx("serif min-w-0 flex-1 text-[14px] leading-snug", active ? "text-navy" : "text-ink")}>{i.title}</span>
                <span className="ml-auto shrink-0">
                  <ClarificationStatusChip status={c?.status ?? "open"} />
                </span>
              </div>
              {c && (
                <div className="mt-1.5 space-y-1">
                  {c.findings.length > 0 ? (
                    <dl className="grid gap-x-3 gap-y-0.5 text-[12px]">
                      {c.findings.map((f) => (
                        <div key={f.label} className="flex gap-1.5">
                          <dt className="shrink-0 text-ink-3">{f.label}:</dt>
                          <dd className="font-medium">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <div className="text-[12px] text-ink-2">{c.clientStatement}</div>
                  )}
                  {c.notes && !c.notes.startsWith("Awaiting:") && <div className="text-[11.5px] text-amber">{c.notes}</div>}
                </div>
              )}
            </div>
          );
        })}
          </div>
        </Card>
        {(analysis.evidenceChecklist ?? []).some((e) => e.status !== "present" && e.askClient) && (
          <>
            <SectionLabel>Evidence checks</SectionLabel>
            <div className="rounded-lg border border-border bg-surface p-3.5">
              <ul className="space-y-2">
                {(analysis.evidenceChecklist ?? [])
                  .filter((e) => e.status !== "present" && e.askClient)
                  .map((e) => {
                    const c = clarifications.find((x) => x.issueId === `evidence:${e.item}`);
                    const active = focusIssueId === `evidence:${e.item}` && (phase === "active" || phase === "phone");
                    return (
                      <li key={e.item} className={cx("rounded-md border p-2.5", active ? "border-navy ring-1 ring-navy" : "border-border")}>
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium">{e.item}</span>
                          <span className="ml-auto shrink-0">
                            <ClarificationStatusChip status={c?.status ?? "open"} />
                          </span>
                        </div>
                        {c ? <div className="mt-1 text-[12px] text-ink-2">{c.clientStatement}</div> : <div className="mt-1 text-[11.5px] text-ink-3">{e.why}</div>}
                      </li>
                    );
                  })}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Transcript() {
  const transcript = useCase((s) => s.transcript);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [transcript.length]);
  if (transcript.length === 0) return <div className="px-5 py-6 text-center text-[12.5px] text-ink-3">The transcript will appear here.</div>;
  return (
    <div ref={ref} className="max-h-[360px] space-y-3 overflow-y-auto px-5 py-4">
      {transcript.map((t) =>
        t.role === "system" ? (
          <div key={t.id} className="text-center text-[11.5px] text-ink-3">
            — {t.text} —
          </div>
        ) : (
          <div key={t.id} className={cx("flex gap-2.5", t.role === "client" && "flex-row-reverse")}>
            <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full", t.role === "agent" ? "bg-navy-soft text-navy" : "bg-surface-2 text-ink-2")}>
              {t.role === "agent" ? <Bot size={13} /> : <User size={13} />}
            </span>
            <div className={cx("max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed", t.role === "agent" ? "bg-surface-2 text-ink" : "bg-navy text-white")}>
              {t.text}
              {t.role === "agent" && t.reasoning && t.reasoning.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer select-none text-[11.5px] text-ink-3 hover:text-ink">Why the agent said this</summary>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[12px] text-ink-2">
                    {t.reasoning.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
