import { z } from "zod";
import { clampOverlayParams, renderOverlayPng } from "@/lib/overlay/render";
import { errorLogContext, log } from "@/lib/observability/logger";
import { rateLimited } from "@/lib/rate-limit";

// The bounty HUD panel as a dynamically rendered transparent PNG — for
// Discord embeds, stream widgets, or anywhere the HTML overlay can't run:
//   GET /api/overlay/image?name=ChickenRat&rows=4
// Same options as /overlay (name, rows, title, avatar, scale). Renders are
// cached ~30 s per parameter set.

export const dynamic = "force-dynamic";

const querySchema = z.object({
  name: z.string().trim().min(1).max(100),
  rows: z.coerce.number().int().min(1).max(10).optional(),
  title: z.string().max(40).optional(),
  avatar: z.url().max(500).optional(),
  scale: z.coerce.number().min(0.4).max(3).optional(),
});

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid overlay image query", issues: parsed.error.issues }, { status: 400 });

  const params = clampOverlayParams(parsed.data);
  try {
    const png = await renderOverlayPng(params);
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
        "Content-Disposition": `inline; filename="bounty-overlay.png"`,
      },
    });
  } catch (error) {
    log.warn("overlay_image_failed", { source: "overlay_image", name: params.name, ...errorLogContext(error) });
    return Response.json({ error: "Overlay image rendering is unavailable right now" }, { status: 503 });
  }
}
