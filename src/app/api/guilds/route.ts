import { z } from "zod";
import { getGuildDirectory } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

const querySchema = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(["score", "winRate", "claims", "credits", "roster"]).default("score"),
});

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid guild competition query" }, { status: 400 });
  return Response.json(await getGuildDirectory(parsed.data), { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" } });
}
