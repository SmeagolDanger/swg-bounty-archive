import { z } from "zod";
import { getParticipant } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return Response.json({ error: "Invalid hunter id" }, { status: 400 });
  const hunter = await getParticipant(parsed.data, "player");
  return hunter ? Response.json(hunter, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" } }) : Response.json({ error: "Hunter not found" }, { status: 404 });
}
