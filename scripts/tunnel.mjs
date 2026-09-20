// Starts a Cloudflare quick tunnel to the dev server and records its URL in .env.local as
// PUBLIC_BASE_URL, so phone calls work whether the app is opened through localhost or the tunnel.
// Quick tunnels get a new hostname on every run; this keeps the env in step without hand-editing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = process.env.PORT || "3111";
const envPath = path.resolve(".env.local");
const child = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });

let recorded = false;
const record = (url) => {
  if (recorded) return;
  recorded = true;
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `PUBLIC_BASE_URL=${url}`;
  const next = /^PUBLIC_BASE_URL=.*$/m.test(env) ? env.replace(/^PUBLIC_BASE_URL=.*$/m, line) : env.replace(/\s*$/, "\n") + line + "\n";
  fs.writeFileSync(envPath, next);
  console.log(`\nTunnel ready: ${url}\nRecorded as PUBLIC_BASE_URL in .env.local. Open the app at ${url} or http://localhost:${port}.\n`);
};

const scan = (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text);
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) record(m[0]);
};
child.stdout.on("data", scan);
child.stderr.on("data", scan);
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
