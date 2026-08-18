import { pool } from "@/lib/db/client";

// Server-side Discord OAuth (authorization code). The app and website share
// one flow: /api/auth/discord/start?client=web|app → Discord → callback.
// prompt=none re-approves silently once the user has authorized, so nobody
// is asked twice.

const DISCORD_API = "https://discord.com/api/v10";

export function discordConfigured(): boolean {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export function authBaseUrl(): string {
  return (process.env.AUTH_BASE_URL ?? "https://jawatracks.com").replace(/\/$/, "");
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID ?? "",
    redirect_uri: `${authBaseUrl()}/api/auth/discord/callback`,
    response_type: "code",
    scope: "identify",
    prompt: "none",
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${params}`;
}

export interface DiscordIdentity {
  id: string;
  username: string;
  avatar: string | null;
}

export async function exchangeCode(code: string): Promise<DiscordIdentity> {
  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID ?? "",
      client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: `${authBaseUrl()}/api/auth/discord/callback`,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Discord token exchange failed: HTTP ${tokenResponse.status}`);
  const { access_token: accessToken } = await tokenResponse.json() as { access_token: string };

  const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) throw new Error(`Discord identity fetch failed: HTTP ${userResponse.status}`);
  const identity = await userResponse.json() as { id: string; username: string; avatar: string | null };
  return { id: identity.id, username: identity.username, avatar: identity.avatar };
}

export async function upsertUser(identity: DiscordIdentity): Promise<string> {
  const avatarUrl = identity.avatar
    ? `https://cdn.discordapp.com/avatars/${identity.id}/${identity.avatar}.png?size=128`
    : null;
  const result = await pool.query(
    `INSERT INTO users(discord_id, discord_username, discord_avatar, last_login_at)
     VALUES($1, $2, $3, now())
     ON CONFLICT(discord_id) DO UPDATE
       SET discord_username=EXCLUDED.discord_username,
           discord_avatar=EXCLUDED.discord_avatar,
           last_login_at=now()
     RETURNING id`,
    [identity.id, identity.username, avatarUrl],
  );
  return result.rows[0].id;
}
