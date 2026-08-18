import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authorizeUrl, discordConfigured } from "@/lib/auth/discord";
import { rateLimited } from "@/lib/rate-limit";

// Begins Discord OAuth for the website (client=web) or the app (client=app).
// State is random, bound to a short-lived cookie, and carries the client so
// the callback knows where to send the session.
export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  if (!discordConfigured()) {
    return Response.json({ error: "Discord sign-in is not configured on this server" }, { status: 503 });
  }
  const client = new URL(request.url).searchParams.get("client") === "app" ? "app" : "web";
  const state = `${client}.${randomBytes(24).toString("base64url")}`;
  const store = await cookies();
  store.set("jt_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return Response.redirect(authorizeUrl(state), 302);
}
