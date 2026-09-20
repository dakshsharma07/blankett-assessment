// Optional natural-voice provider. Enabled when ELEVENLABS_API_KEY is set; the app falls back
// to the browser's Web Speech API otherwise.

const BASE = "https://api.elevenlabs.io";

export function elevenLabsEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not configured");
  return k;
}

let cachedVoiceId: string | null = null;

/** "Sarah", an ElevenLabs premade voice with the same id on every account: used when the key cannot list voices. */
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

/** Resolve the voice to use: env override, else a sensible premade voice from the account. */
export async function resolveVoiceId(): Promise<string> {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  if (cachedVoiceId) return cachedVoiceId;
  const res = await fetch(`${BASE}/v1/voices`, { headers: { "xi-api-key": key() } });
  if (res.status === 401) {
    // Key was created without the voices_read permission; text-to-speech itself may still be allowed.
    console.warn("[elevenlabs] key cannot list voices; using the default premade voice (set ELEVENLABS_VOICE_ID to choose)");
    cachedVoiceId = DEFAULT_VOICE_ID;
    return cachedVoiceId;
  }
  if (!res.ok) throw new Error(`ElevenLabs voices lookup failed: ${res.status}`);
  const data = (await res.json()) as { voices: Array<{ voice_id: string; name: string; category?: string; labels?: Record<string, string> }> };
  const prefs = ["Sarah", "Rachel", "Alice", "Matilda", "Jessica", "Lily", "Charlotte"];
  const pick =
    prefs.map((n) => data.voices.find((v) => v.name === n)).find(Boolean) ??
    data.voices.find((v) => v.category === "premade" && /female/i.test(v.labels?.gender ?? "")) ??
    data.voices[0];
  if (!pick) throw new Error("No ElevenLabs voices available on this account");
  cachedVoiceId = pick.voice_id;
  return cachedVoiceId;
}

/** `fast` picks the lowest-latency model (phone lines, where every hundred milliseconds is dead air). */
export async function synthesize(text: string, opts: { fast?: boolean } = {}): Promise<ArrayBuffer> {
  const voiceId = await resolveVoiceId();
  const model = opts.fast ? process.env.ELEVENLABS_FAST_MODEL || "eleven_flash_v2_5" : process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
  // Phone audio is narrowband, so a small file is enough there and transfers faster.
  const format = opts.fast ? "mp3_22050_32" : "mp3_44100_128";
  const res = await fetch(`${BASE}/v1/text-to-speech/${voiceId}?output_format=${format}`, {
    method: "POST",
    headers: { "xi-api-key": key(), "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed: 1.02 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
}

let sttPermitted: boolean | null = null;

/** Whether this key may use speech-to-text. Probed once (a request without audio is rejected for the
 *  missing file when permitted, and for the missing permission when not). */
export async function transcriptionAvailable(): Promise<boolean> {
  if (!elevenLabsEnabled() || process.env.ELEVENLABS_STT === "0") return false;
  if (sttPermitted !== null) return sttPermitted;
  try {
    // Parameters are validated before permissions, so the probe carries a fraction of a second of silence.
    const fd = new FormData();
    fd.append("model_id", "scribe_v1");
    fd.append("file", new Blob([silentWav()], { type: "audio/wav" }), "probe.wav");
    const res = await fetch(`${BASE}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: fd });
    const body = res.status === 401 ? await res.text() : "";
    sttPermitted = !(res.status === 401 && /missing_permissions|speech_to_text/.test(body));
  } catch {
    sttPermitted = true; // network hiccup: let the call attempt it and fall back on failure
  }
  if (!sttPermitted) console.warn("[elevenlabs] key lacks the speech_to_text permission; the browser's speech recognition will be used");
  return sttPermitted;
}

/** A 0.1 s, 8 kHz, 16-bit mono WAV of silence. */
function silentWav(): ArrayBuffer {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples * 2, true);
  return buf;
}

export async function transcribe(file: Blob, fileName: string): Promise<string> {
  const models = [process.env.ELEVENLABS_STT_MODEL || "scribe_v1", "scribe_v2"];
  let lastErr = "";
  for (const model of [...new Set(models)]) {
    const fd = new FormData();
    fd.append("model_id", model);
    fd.append("language_code", "en");
    fd.append("tag_audio_events", "false");
    fd.append("file", file, fileName);
    const res = await fetch(`${BASE}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: fd });
    if (res.ok) {
      const data = (await res.json()) as { text?: string; transcripts?: Array<{ text: string }> };
      return (data.text ?? data.transcripts?.map((t) => t.text).join(" ") ?? "").trim();
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
    if (res.status !== 400 && res.status !== 422) break;
  }
  throw new Error(`ElevenLabs STT failed: ${lastErr}`);
}
