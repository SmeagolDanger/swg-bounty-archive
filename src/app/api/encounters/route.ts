import { z } from "zod";
import { getEncounters } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  outcome: z.enum(["KILL", "FAILED"]).optional(),
  minCredits: z.coerce.number().int().nonnegative().optional(),
  maxCredits: z.coerce.number().int().nonnegative().optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().min(10).max(100).optional(),
});

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 });
  return Response.json(await getEncounters(parsed.data));
}
