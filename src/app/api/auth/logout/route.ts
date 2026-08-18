import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request) {
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
