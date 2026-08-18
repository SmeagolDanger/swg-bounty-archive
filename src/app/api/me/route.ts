import { authedUser } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = await authedUser(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({
    id: user.id,
    discordUsername: user.discordUsername,
    discordAvatar: user.discordAvatar,
  });
}
