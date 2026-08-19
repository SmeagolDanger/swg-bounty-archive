import { z } from "zod";
import { pool } from "@/lib/db/client";
import { authedUser, userForApiToken } from "@/lib/auth/session";
import { buildSessions } from "@/lib/combat/sessions";
import { rateLimited } from "@/lib/rate-limit";

// Combat history: streamed events grouped into sessions and encounters with
// per-player stats, feeding the app's session browser and share reports.
// Events are kept forever; a request covers the newest 200k events in range.
export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = (await authedUser(request)) ?? (await userForApiToken(request));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const days = z.coerce.number().int().min(1).max(3650).catch(7).parse(url.searchParams.get("days") ?? undefined);
  const events = await pool.query(
    `SELECT * FROM (
       SELECT kind, source, target, ability, amount::float8 AS amount, flag, occurred_at
       FROM combat_events
       WHERE user_id=$1 AND occurred_at > now() - ($2 || ' days')::interval
       ORDER BY occurred_at DESC, id DESC LIMIT 200000
     ) recent ORDER BY occurred_at ASC`,
    [user.id, String(days)],
  );
  const sessions = buildSessions(
    events.rows.map((row) => ({
      kind: row.kind,
      source: row.source,
      target: row.target,
      ability: row.ability,
      amount: Number(row.amount),
      flag: row.flag,
      occurredAt: new Date(row.occurred_at),
    })),
  );
  return Response.json({ sessions });
}
