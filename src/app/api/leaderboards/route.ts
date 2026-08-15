import { z } from "zod";
import { getLeaderboard } from "@/lib/data";
import { PERIODS, SUBJECTS, TRACKED_BOARD_IDS } from "@/lib/ingestion/config";
import { rateLimited } from "@/lib/rate-limit";

const schema = z.object({
  board: z.enum(TRACKED_BOARD_IDS), period: z.enum(PERIODS).default("CURRENT"), subject: z.enum(SUBJECTS).default("player"),
});

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 });
  return Response.json(await getLeaderboard(parsed.data.board, parsed.data.period, parsed.data.subject), { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" } });
}
