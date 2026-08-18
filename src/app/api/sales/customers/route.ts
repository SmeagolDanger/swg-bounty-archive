import { pool } from "@/lib/db/client";
import { authedUser, userForApiToken } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";

// SWGAide-style customer ledger: everyone who has bought from you, ranked.
export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = (await authedUser(request)) ?? (await userForApiToken(request));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const character = new URL(request.url).searchParams.get("character")?.trim() || null;
  const customers = await pool.query(
    `SELECT buyer,
       count(*)::int AS purchases,
       sum(credits)::float8 AS credits,
       max(credits)::float8 AS best,
       min(occurred_at) AS first_purchase,
       max(occurred_at) AS last_purchase,
       (array_agg(item_name ORDER BY credits DESC))[1] AS top_item
     FROM mail_sales
     WHERE user_id=$1 AND ($2::text IS NULL OR character_name=$2) AND buyer <> ''
     GROUP BY buyer ORDER BY credits DESC LIMIT 200`,
    [user.id, character],
  );
  return Response.json({ customers: customers.rows });
}
