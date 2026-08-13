import { z } from "zod";
import { getRawIngestion } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return Response.json({ error: "Invalid ingestion id" }, { status: 400 });
  const row = await getRawIngestion(parsed.data);
  return row ? Response.json(row, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }) : Response.json({ error: "Raw response not found" }, { status: 404 });
}
