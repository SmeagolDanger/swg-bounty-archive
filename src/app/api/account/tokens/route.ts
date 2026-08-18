import { z } from "zod";
import { pool } from "@/lib/db/client";
import { authedUser } from "@/lib/auth/session";
import { mintToken } from "@/lib/auth/tokens";
import { rateLimited } from "@/lib/rate-limit";

// Companion API tokens: listed masked, created once with the secret shown a
// single time, revocable. Used by the mail companion's uploads.
export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = await authedUser(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tokens = await pool.query(
    `SELECT id, name, created_at, last_used_at FROM api_tokens
     WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [user.id],
  );
  return Response.json({ tokens: tokens.rows });
}

export async function POST(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = await authedUser(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "name must be 1-60 characters" }, { status: 400 });
  const { token, hash } = mintToken("api");
  const created = await pool.query(
    "INSERT INTO api_tokens(user_id, name, token_hash) VALUES($1, $2, $3) RETURNING id, name, created_at",
    [user.id, parsed.data.name, hash],
  );
  // The plain token is returned exactly once; only its hash is stored.
  return Response.json({ ...created.rows[0], token });
}
