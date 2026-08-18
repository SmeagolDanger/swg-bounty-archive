import { z } from "zod";
import { pool } from "@/lib/db/client";
import { authedUser, userForApiToken } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";

// Live combat feed for the app's DPS monitor. The client polls with the last
// event id it has seen; the first poll (after=0) seeds with the most recent
// three minutes so an in-progress fight appears immediately.
export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = (await authedUser(request)) ?? (await userForApiToken(request));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const after = z.coerce.number().int().min(0).catch(0).parse(url.searchParams.get("after") ?? undefined);
  const events = await pool.query(
    `SELECT id, character_name, kind, source, target, ability, amount::float8 AS amount, flag, occurred_at
     FROM combat_events
     WHERE user_id=$1
       AND ($2::bigint = 0 OR id > $2)
       AND ($2::bigint <> 0 OR occurred_at > now() - interval '180 seconds')
     ORDER BY id ASC LIMIT 600`,
    [user.id, after],
  );
  const latest = events.rows.length ? Number(events.rows[events.rows.length - 1].id) : after;
  return Response.json({
    events: events.rows.map((row) => ({ ...row, id: Number(row.id) })),
    latest,
    serverTime: new Date().toISOString(),
  });
}
