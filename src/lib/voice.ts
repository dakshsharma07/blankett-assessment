"use client";

// Browser voice layer: Web Speech API for speech-to-text and text-to-speech.
// No external voice provider is required; the reasoning behind each turn comes from the
// server (/api/converse). Everything here degrades to typed input when unsupported.

/* eslint-disable @typescript-eslint/no-explicit-any */

export function supportsTTS(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function supportsSTT(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // not loaded yet; try again next time
  const prefs = [/samantha/i, /google us english/i, /microsoft (aria|jenny|guy)/i, /karen/i, /moira/i, /daniel/i, /alex/i];
  for (const re of prefs) {
    const v = voices.find((v) => re.test(v.name) && v.lang.toLowerCase().startsWith("en"));
    if (v) return (cachedVoice = v);
  }
  cachedVoice = voices.find((v) => v.lang === "en-US") ?? voices.find((v) => v.lang.toLowerCase().startsWith("en")) ?? voices[0];
  return cachedVoice;
}

export function primeVoices() {
  if (!supportsTTS()) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = undefined;
    pickVoice();
  };
}

export function stopSpeaking() {
  if (supportsTTS()) window.speechSynthesis.cancel();
}

/** Speak text aloud; resolves when finished (or immediately if unsupported). */
export function speak(text: string, opts: { rate?: number; onStart?: () => void } = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!supportsTTS() || !text.trim()) return resolve();
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = "en-US";
    u.rate = opts.rate ?? 1.0;
    u.pitch = 1.0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      resolve();
    };
    u.onstart = () => opts.onStart?.();
    u.onend = finish;
    u.onerror = finish;
    // Some engines never fire onend if the utterance is cancelled; poll as a safety net.
    const watchdog = setInterval(() => {
      if (!synth.speaking && !synth.pending) finish();
    }, 500);
    synth.speak(u);
  });
}

export interface RecognizerHandlers {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd?: () => void;
}

/** One-shot speech recognizer. Call start(); it stops after the first final result. */
export class Recognizer {
  private rec: any = null;
  private stoppedByUser = false;
  private gotFinal = false;
  private interim = "";

  constructor(private handlers: RecognizerHandlers) {}

  start(): boolean {
    const w = window as any;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      this.handlers.onError("Speech recognition is not supported in this browser.");
      return false;
    }
    this.stop();
    const rec = new Ctor();
    this.rec = rec;
    this.stoppedByUser = false;
    this.gotFinal = false;
    this.interim = "";
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (interimText) {
        this.interim = interimText;
        this.handlers.onInterim?.(interimText);
      }
      if (finalText.trim()) {
        this.gotFinal = true;
        this.handlers.onFinal(finalText.trim());
      }
    };
    rec.onerror = (ev: any) => {
      const code = ev?.error ?? "unknown";
      if (code === "aborted" || (code === "no-speech" && this.stoppedByUser)) return;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was blocked. Allow the microphone or type your answer.",
        "service-not-allowed": "Speech recognition is unavailable in this browser. Type your answer instead.",
        network: "Speech recognition needs a network-backed engine that this browser does not provide. Type your answer instead.",
        "no-speech": "No speech detected.",
        "audio-capture": "No microphone was found.",
      };
      this.handlers.onError(messages[code] ?? `Speech recognition error: ${code}`);
    };
    rec.onend = () => {
      // If recognition ended with only an interim transcript (some engines never mark final), promote it.
      if (!this.gotFinal && !this.stoppedByUser && this.interim.trim()) {
        this.gotFinal = true;
        this.handlers.onFinal(this.interim.trim());
      }
      this.handlers.onEnd?.();
    };
    try {
      rec.start();
      return true;
    } catch (e) {
      this.handlers.onError(e instanceof Error ? e.message : "Could not start speech recognition.");
      return false;
    }
  }

  /** Stop listening; if there is interim text, deliver it as the final result. */
  stop(deliverInterim = false) {
    if (!this.rec) return;
    this.stoppedByUser = true;
    if (deliverInterim && !this.gotFinal && this.interim.trim()) {
      this.gotFinal = true;
      this.handlers.onFinal(this.interim.trim());
    }
    try {
      this.rec.onresult = null;
      this.rec.onend = null;
      this.rec.onerror = null;
      this.rec.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }
}

// ---------------------------------------------------------------------------
// Natural voice (server-side provider). Used when /api/status reports voice: "elevenlabs".
// ---------------------------------------------------------------------------

let currentAudio: HTMLAudioElement | null = null;

export function stopRemoteSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

/** Fetch synthesized speech from the server and play it; rejects if the provider fails. */
export async function speakRemote(text: string, opts: { onStart?: () => void } = {}): Promise<void> {
  stopRemoteSpeaking();
  const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `TTS failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  await new Promise<void>((resolve, reject) => {
    const a = new Audio(url);
    currentAudio = a;
    a.onplay = () => opts.onStart?.();
    a.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === a) currentAudio = null;
      resolve();
    };
    a.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Audio playback failed"));
    };
    a.onpause = () => {
      // Interrupted by stopRemoteSpeaking()
      if (currentAudio !== a) resolve();
    };
    a.play().catch(reject);
  });
}

export interface RecorderHandlers {
  /** Called with the microphone level (0..1) ~20x/s for a meter. */
  onLevel?: (level: number) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd?: () => void;
}

/**
 * Records one utterance from the microphone, stops on trailing silence, and sends it to the
 * server for transcription. Resolves via onFinal with the transcript.
 */
export class RemoteRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private ctx: AudioContext | null = null;
  private raf = 0;
  private chunks: Blob[] = [];
  private stopped = false;
  private cancelled = false;

  constructor(private handlers: RecorderHandlers, private opts: { silenceMs?: number; maxMs?: number; noSpeechMs?: number } = {}) {}

  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      this.handlers.onError("Microphone access was blocked. Allow the microphone or type your answer.");
      return false;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.rec = rec;
    this.chunks = [];
    this.stopped = false;
    this.cancelled = false;
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => void this.finish(mime || "audio/webm");
    rec.start(250);

    // Silence detection
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const silenceMs = this.opts.silenceMs ?? 1100;
    const maxMs = this.opts.maxMs ?? 25000;
    const noSpeechMs = this.opts.noSpeechMs ?? 8000;
    const t0 = performance.now();
    let speechStarted = 0;
    let lastVoice = 0;
    const tick = () => {
      if (this.stopped) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      this.handlers.onLevel?.(Math.min(1, rms * 8));
      if (rms > 0.015) {
        if (!speechStarted) speechStarted = now;
        lastVoice = now;
      }
      if (speechStarted && now - lastVoice > silenceMs) return this.stop();
      if (!speechStarted && now - t0 > noSpeechMs) {
        this.cancelled = true;
        this.stop();
        this.handlers.onError("No speech detected.");
        return;
      }
      if (now - t0 > maxMs) return this.stop();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    return true;
  }

  /** Stop recording and transcribe what was captured. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
  }

  /** Stop recording and discard the audio. */
  cancel() {
    this.cancelled = true;
    this.stop();
  }

  private async finish(mime: string) {
    this.handlers.onEnd?.();
    if (this.cancelled) return;
    const blob = new Blob(this.chunks, { type: mime });
    if (blob.size < 1000) return;
    try {
      const fd = new FormData();
      fd.append("audio", blob, mime.includes("mp4") ? "audio.mp4" : "audio.webm");
      const res = await fetch("/api/stt", { method: "POST", body: fd });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `STT failed (${res.status})`);
      if (data.text?.trim()) this.handlers.onFinal(data.text.trim());
      else this.handlers.onError("No speech detected.");
    } catch (e) {
      this.handlers.onError(e instanceof Error ? e.message : "Transcription failed.");
    }
  }
}
