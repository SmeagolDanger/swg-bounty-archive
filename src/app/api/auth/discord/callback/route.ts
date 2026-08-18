import { cookies } from "next/headers";
import { authBaseUrl, exchangeCode, upsertUser } from "@/lib/auth/discord";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";

// Completes Discord OAuth. Web clients get the session cookie and land on
// /account; the app gets its session token via the jawatracks:// deep link.
export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const store = await cookies();
  const expected = store.get("jt_oauth_state")?.value;
  store.delete("jt_oauth_state");

  if (!code || !expected || state !== expected) {
    return Response.redirect(`${authBaseUrl()}/account?error=state`, 302);
  }
  try {
    const identity = await exchangeCode(code);
    const userId = await upsertUser(identity);
    const client = state.startsWith("app.") ? "app" : "web";
    const token = await createSession(userId, client);
    if (client === "app") {
      return Response.redirect(`jawatracks://auth#token=${encodeURIComponent(token)}`, 302);
    }
    store.set(SESSION_COOKIE, token, sessionCookieOptions());
    return Response.redirect(`${authBaseUrl()}/account`, 302);
  } catch {
    return Response.redirect(`${authBaseUrl()}/account?error=oauth`, 302);
  }
}
