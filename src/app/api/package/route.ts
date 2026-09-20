import { isLive } from "@/lib/ai/client";
import { livePackage } from "@/lib/ai/package";
import { demoPackage } from "@/lib/demo/package";
import type { PackageRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json()) as PackageRequest;
  try {
    const result = isLive() ? await livePackage(body) : demoPackage(body);
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 500 });
  }
}
