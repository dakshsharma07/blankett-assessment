import Anthropic from "@anthropic-ai/sdk";
import type { EngineStatus } from "@/lib/types";
import { elevenLabsEnabled, transcriptionAvailable } from "@/lib/ai/elevenlabs";
import { twilioConfigured } from "@/lib/phone/twilio";

export const MODEL = process.env.BLANKETT_MODEL || "claude-opus-5";

/** Live AI mode is enabled when the SDK can resolve a credential. */
export function isLive(): boolean {
  if (process.env.BLANKETT_FORCE_DEMO === "1") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let _client: Anthropic | null = null;
export function client(): Anthropic {
  // Transient 5xx/429s must not break a live call; retry generously.
  if (!_client) _client = new Anthropic({ maxRetries: 4 });
  return _client;
}

export async function engineStatus(): Promise<EngineStatus> {
  const live = isLive();
  return {
    live,
    model: live ? MODEL : "local-rules",
    label: live ? `Live AI, ${MODEL}` : "Demo mode, rule-based (no API key)",
    voice: elevenLabsEnabled() ? "elevenlabs" : "browser",
    transcription: await transcriptionAvailable(),
    phone: { configured: twilioConfigured(), to: process.env.DEMO_CLIENT_PHONE ?? null, from: process.env.TWILIO_FROM_NUMBER ?? null, publicUrl: process.env.PUBLIC_BASE_URL ?? null },
  };
}
