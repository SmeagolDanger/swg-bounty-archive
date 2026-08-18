import { pool } from "@/lib/db/client";
import { authedUser, userForApiToken } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = (await authedUser(request)) ?? (await userForApiToken(request));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const character = new URL(request.url).searchParams.get("character")?.trim() || null;

  const windows = await pool.query(
    `SELECT
       count(*) FILTER (WHERE occurred_at >= date_trunc('day', now()))::int AS today_sales,
       coalesce(sum(credits) FILTER (WHERE occurred_at >= date_trunc('day', now())), 0)::float8 AS today_credits,
       count(*) FILTER (WHERE occurred_at >= now() - interval '7 days')::int AS week_sales,
       coalesce(sum(credits) FILTER (WHERE occurred_at >= now() - interval '7 days'), 0)::float8 AS week_credits,
       count(*) FILTER (WHERE occurred_at >= now() - interval '30 days')::int AS month_sales,
       coalesce(sum(credits) FILTER (WHERE occurred_at >= now() - interval '30 days'), 0)::float8 AS month_credits,
       count(*)::int AS total_sales,
       coalesce(sum(credits), 0)::float8 AS total_credits,
       coalesce(avg(credits), 0)::float8 AS average_credits,
       coalesce(max(credits), 0)::float8 AS best_credits
     FROM mail_sales WHERE user_id=$1 AND ($2::text IS NULL OR character_name=$2)`,
    [user.id, character],
  );
  const topItems = await pool.query(
    `SELECT item_name, count(*)::int AS sales, sum(credits)::float8 AS credits
     FROM mail_sales WHERE user_id=$1 AND ($2::text IS NULL OR character_name=$2)
       AND occurred_at >= now() - interval '30 days'
     GROUP BY item_name ORDER BY credits DESC LIMIT 10`,
    [user.id, character],
  );
  const daily = await pool.query(
    `WITH days AS (SELECT generate_series((now() - interval '13 days')::date, now()::date, '1 day')::date AS day)
     SELECT days.day::text AS day,
       coalesce(count(s.id), 0)::int AS sales,
       coalesce(sum(s.credits), 0)::float8 AS credits
     FROM days LEFT JOIN mail_sales s
       ON s.user_id=$1 AND s.occurred_at::date = days.day AND ($2::text IS NULL OR s.character_name=$2)
     GROUP BY days.day ORDER BY days.day`,
    [user.id, character],
  );
  const characters = await pool.query(
    "SELECT DISTINCT character_name FROM mail_sales WHERE user_id=$1 AND character_name <> '' ORDER BY character_name",
    [user.id],
  );
  return Response.json({
    summary: windows.rows[0],
    topItems: topItems.rows,
    daily: daily.rows,
    characters: characters.rows.map((row) => row.character_name),
  });
}
