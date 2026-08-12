import { getDashboard } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  return Response.json(await getDashboard(), { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } });
}
