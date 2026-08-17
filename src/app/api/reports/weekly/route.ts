import { z } from "zod";
import { getWeeklyReport } from "@/lib/data";
import { PERIODS } from "@/lib/ingestion/config";
import { rateLimited } from "@/lib/rate-limit";

const schema = z.object({
  period: z.enum(PERIODS).default("CURRENT"),
  cycle: z.iso.datetime({ offset: true }).optional(),
});

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 });
  return Response.json(await getWeeklyReport(parsed.data.period, parsed.data.cycle), {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" },
  });
}
