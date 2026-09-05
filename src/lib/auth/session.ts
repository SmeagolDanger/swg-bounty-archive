import { cookies } from "next/headers";
import { pool } from "@/lib/db/client";
import { hashToken, looksLike, mintToken } from "./tokens";

// Session lifecycle: web sessions ride an httpOnly cookie, app sessions ride
// an Authorization bearer held in the device keychain. Both slide their
// expiry on use so an active user never re-authenticates.

export const SESSION_COOKIE = "jt_session";
const SESSION_DAYS = 180;

export interface AuthedUser {
  id: string;
  discordId: string;
  discordUsername: string;
  discordAvatar: string | null;
}

export async function createSession(userId: string, kind: "web" | "app"): Promise<string> {
  const { token, hash } = mintToken("session");
  await pool.query(
    `INSERT INTO sessions(token_hash, user_id, kind, expires_at)
     VALUES($1, $2, $3, now() + interval '${SESSION_DAYS} days')`,
    [hash, userId, kind],
  );
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash=$1", [hashToken(token)]);
}

async function userForSessionToken(token: string): Promise<AuthedUser | null> {
  if (!looksLike("session", token)) return null;
  const result = await pool.query(
    `UPDATE sessions SET last_used_at=now(),
        expires_at=GREATEST(expires_at, now() + interval '${SESSION_DAYS} days')
     WHERE token_hash=$1 AND expires_at > now()
     RETURNING user_id`,
    [hashToken(token)],
  );
  const userId = result.rows[0]?.user_id;
  if (!userId) return null;
  const user = await pool.query(
    "SELECT id, discord_id, discord_username, discord_avatar FROM users WHERE id=$1",
    [userId],
  );
  const row = user.rows[0];
  if (!row) return null;
  return { id: row.id, discordId: row.discord_id, discordUsername: row.discord_username, discordAvatar: row.discord_avatar };
}

/// Resolve the caller from a bearer header or the web cookie.
export async function authedUser(request?: Request): Promise<AuthedUser | null> {
  const bearer = request?.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return userForSessionToken(bearer.slice(7).trim());
  }
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  return cookie ? userForSessionToken(cookie) : null;
}

export function sessionCookieOptions(): { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number } {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}
