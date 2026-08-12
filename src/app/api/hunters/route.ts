import { z } from "zod";
import { getHunterDirectory } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

const querySchema = z.object({
  q: z.string().max(100).optional(),
  activity: z.enum(["all", "seen", "unseen"]).default("all"),
  sort: z.enum(["name", "winRate", "encounters", "credits", "lastActive"]).default("encounters"),
  page: z.coerce.number().int().positive().default(1),
});

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid hunter directory query" }, { status: 400 });
  return Response.json(await getHunterDirectory(parsed.data));
}
