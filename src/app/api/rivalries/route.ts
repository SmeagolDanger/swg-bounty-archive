import { z } from "zod";
import { getRivalries } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

const querySchema = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(["encounters", "closest", "revenge", "longest", "recent"]).default("encounters"),
  page: z.coerce.number().int().positive().default(1),
});

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid rivalry query" }, { status: 400 });
  return Response.json(await getRivalries(parsed.data));
}
