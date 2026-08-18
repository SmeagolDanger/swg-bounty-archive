import { pool } from "@/lib/db/client";
import { authedUser, userForApiToken } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = (await authedUser(request)) ?? (await userForApiToken(request));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const character = url.searchParams.get("character")?.trim() || null;
  // Day buckets follow the caller's timezone so "today" and the daily chart
  // match the player's clock, not UTC. Unknown names fall back to UTC.
  const tzRaw = url.searchParams.get("tz")?.trim() || "UTC";
  const tzOk = /^[A-Za-z0-9_+\-/]{1,64}$/.test(tzRaw)
    && (await pool.query("SELECT 1 FROM pg_timezone_names WHERE name=$1", [tzRaw])).rowCount === 1;
  const tz = tzOk ? tzRaw : "UTC";

  const windows = await pool.query(
    `SELECT
       count(*) FILTER (WHERE (occurred_at AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date)::int AS today_sales,
       coalesce(sum(credits) FILTER (WHERE (occurred_at AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date), 0)::float8 AS today_credits,
       count(*) FILTER (WHERE occurred_at >= now() - interval '7 days')::int AS week_sales,
       coalesce(sum(credits) FILTER (WHERE occurred_at >= now() - interval '7 days'), 0)::float8 AS week_credits,
       count(*) FILTER (WHERE occurred_at >= now() - interval '30 days')::int AS month_sales,
       coalesce(sum(credits) FILTER (WHERE occurred_at >= now() - interval '30 days'), 0)::float8 AS month_credits,
       count(*)::int AS total_sales,
       coalesce(sum(credits), 0)::float8 AS total_credits,
       coalesce(avg(credits), 0)::float8 AS average_credits,
       coalesce(max(credits), 0)::float8 AS best_credits
     FROM mail_sales WHERE user_id=$1 AND ($2::text IS NULL OR character_name=$2)`,
    [user.id, character, tz],
  );
  const topItems = await pool.query(
    `SELECT item_name, count(*)::int AS sales, sum(credits)::float8 AS credits
     FROM mail_sales WHERE user_id=$1 AND ($2::text IS NULL OR character_name=$2)
       AND occurred_at >= now() - interval '30 days'
     GROUP BY item_name ORDER BY credits DESC LIMIT 10`,
    [user.id, character],
  );
  const daily = await pool.query(
    `WITH days AS (SELECT generate_series(((now() AT TIME ZONE $3)::date - 13), (now() AT TIME ZONE $3)::date, '1 day')::date AS day)
     SELECT days.day::text AS day,
       coalesce(count(s.id), 0)::int AS sales,
       coalesce(sum(s.credits), 0)::float8 AS credits
     FROM days LEFT JOIN mail_sales s
       ON s.user_id=$1 AND (s.occurred_at AT TIME ZONE $3)::date = days.day AND ($2::text IS NULL OR s.character_name=$2)
     GROUP BY days.day ORDER BY days.day`,
    [user.id, character, tz],
  );
  const purchases = await pool.query(
    `SELECT
       count(*) FILTER (WHERE occurred_at >= now() - interval '30 days')::int AS month_purchases,
       coalesce(sum(credits) FILTER (WHERE occurred_at >= now() - interval '30 days'), 0)::float8 AS month_spent,
       count(*)::int AS total_purchases,
       coalesce(sum(credits), 0)::float8 AS total_spent
     FROM mail_purchases WHERE user_id=$1 AND ($2::text IS NULL OR character_name=$2)`,
    [user.id, character],
  );
  const topCustomers = await pool.query(
    `SELECT buyer, count(*)::int AS purchases, sum(credits)::float8 AS credits, max(occurred_at) AS last_purchase
     FROM mail_sales WHERE user_id=$1 AND ($2::text IS NULL OR character_name=$2) AND buyer <> ''
     GROUP BY buyer ORDER BY credits DESC LIMIT 10`,
    [user.id, character],
  );
  const characters = await pool.query(
    "SELECT DISTINCT character_name FROM mail_sales WHERE user_id=$1 AND character_name <> '' ORDER BY character_name",
    [user.id],
  );
  return Response.json({
    summary: windows.rows[0],
    purchases: purchases.rows[0],
    topCustomers: topCustomers.rows,
    topItems: topItems.rows,
    daily: daily.rows,
    characters: characters.rows.map((row) => row.character_name),
  });
}
