import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) await destroySession(bearer.slice(7).trim());
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (cookie) {
    await destroySession(cookie);
    store.delete(SESSION_COOKIE);
  }
  return Response.json({ ok: true });
}
