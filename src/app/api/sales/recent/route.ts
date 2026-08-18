import { z } from "zod";
import { pool } from "@/lib/db/client";
import { authedUser, userForApiToken } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = (await authedUser(request)) ?? (await userForApiToken(request));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(url.searchParams.get("limit") ?? undefined);
  const character = url.searchParams.get("character")?.trim() || null;
  const buyer = url.searchParams.get("buyer")?.trim() || null;
  const sales = await pool.query(
    `SELECT id, character_name, item_name, buyer, credits::float8 AS credits, vendor, sale_type, occurred_at
     FROM mail_sales WHERE user_id=$1 AND ($2::text IS NULL OR character_name=$2) AND ($4::text IS NULL OR buyer=$4)
     ORDER BY occurred_at DESC LIMIT $3`,
    [user.id, character, limit, buyer],
  );
  return Response.json({ sales: sales.rows });
}
