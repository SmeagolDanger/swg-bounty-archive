import { z } from "zod";
import { searchEntities } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = z.string().trim().min(1).max(100).safeParse(new URL(request.url).searchParams.get("q"));
  if (!parsed.success) return Response.json({ error: "q must be 1-100 characters" }, { status: 400 });
  return Response.json({ results: await searchEntities(parsed.data) }, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" } });
}
