import { authedUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await authedUser(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({
    id: user.id,
    discordUsername: user.discordUsername,
    discordAvatar: user.discordAvatar,
  });
}
