import { z } from "zod";
import { getRawData } from "@/lib/data";
import { rateLimited } from "@/lib/rate-limit";

const schema = z.object({ q: z.string().max(160).optional(), source: z.string().max(80).optional(),
  status: z.enum(["PROCESSED", "FAILED", "HTTP_ERROR", "RECEIVED"]).optional(), page: z.coerce.number().int().positive().default(1),
  from: z.iso.date().optional(), to: z.iso.date().optional() });

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid raw-data query" }, { status: 400 });
  return Response.json(await getRawData(parsed.data));
}
