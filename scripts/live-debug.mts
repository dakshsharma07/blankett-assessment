// Replays the last failing converse request with variations to isolate a deterministic API error.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ConverseSchema } from "../src/lib/ai/schemas.ts";

const req = JSON.parse(fs.readFileSync("scripts/.live-last-request.json", "utf8"));
const client = new Anthropic({ maxRetries: 0 });
const MODEL = "claude-opus-5";

// Rebuild messages exactly like liveConverse does
const messages: Anthropic.MessageParam[] = [];
const spoken = req.transcript.filter((t: any) => t.role !== "system");
if (spoken.length === 0 || spoken[0].role === "agent") messages.push({ role: "user", content: "[Call connected. The client has picked up. Begin the call.]" });
for (const t of spoken) messages.push({ role: t.role === "agent" ? "assistant" : "user", content: t.role === "agent" ? t.text : `<client_said>${t.text}</client_said>` });
messages.push({ role: "user", content: `<client_said>${req.clientUtterance}</client_said>\n<record_so_far>\n(omitted)\n</record_so_far>` });

const variants: Array<[string, any]> = [
  ["baseline: format+thinking+cache", { thinking: { type: "adaptive" }, output_config: { effort: "low", format: zodOutputFormat(ConverseSchema) }, system: [{ type: "text", text: "You are a helpful case agent. Reply in the required JSON.", cache_control: { type: "ephemeral" } }] }],
  ["no cache_control", { thinking: { type: "adaptive" }, output_config: { effort: "low", format: zodOutputFormat(ConverseSchema) }, system: "You are a helpful case agent. Reply in the required JSON." }],
  ["no thinking", { output_config: { effort: "low", format: zodOutputFormat(ConverseSchema) }, system: "You are a helpful case agent. Reply in the required JSON." }],
  ["no format", { thinking: { type: "adaptive" }, output_config: { effort: "low" }, system: "You are a helpful case agent. Reply briefly." }],
  ["effort medium + format", { thinking: { type: "adaptive" }, output_config: { effort: "medium", format: zodOutputFormat(ConverseSchema) }, system: "You are a helpful case agent. Reply in the required JSON." }],
];
for (const [name, extra] of variants) {
  const t0 = Date.now();
  try {
    const r = await client.messages.create({ model: MODEL, max_tokens: 2000, messages, ...extra });
    console.log(`OK   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s) stop=${r.stop_reason}`);
  } catch (e: any) {
    console.log(`FAIL ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${e.status} ${e.message?.slice(0, 120)}`);
  }
}
