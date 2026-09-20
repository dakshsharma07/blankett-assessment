import { engineStatus } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await engineStatus());
}
