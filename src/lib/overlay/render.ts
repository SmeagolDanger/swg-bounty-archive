import { existsSync } from "node:fs";

// Server-side PNG rendering of the /overlay panel, following the weekly
// Discord share card: headless Chromium (shipped in the container) loads the
// page this app itself serves and screenshots the panel element with a
// transparent background.
//
// Renders are cached briefly and deduplicated per parameter set, so a busy
// stream widget or Discord unfurl costs one Chromium launch per TTL, not one
// per request.

export interface OverlayImageParams {
  name: string;
  period: "recent" | "today" | "cycle";
  tz: string;
  rows?: number;
  title?: string;
  avatar?: string;
  scale: number;
}

const validTimeZone = (value: string | undefined): string => {
  if (!value) return "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return value; } catch { return "UTC"; }
};

export function clampOverlayParams(input: { name: string; period?: string; tz?: string; rows?: number; title?: string; avatar?: string; scale?: number }): OverlayImageParams {
  return {
    name: input.name.trim().slice(0, 100),
    period: input.period === "today" || input.period === "cycle" ? input.period : "recent",
    // The server renders in a UTC container; without an explicit zone the
    // "today" boundary would be UTC midnight regardless of the streamer.
    tz: validTimeZone(input.tz),
    rows: input.rows === undefined ? undefined : Math.max(1, Math.min(100, Math.floor(input.rows) || 4)),
    title: input.title?.slice(0, 40) || undefined,
    avatar: input.avatar?.slice(0, 500) || undefined,
    scale: Math.max(0.4, Math.min(3, input.scale ?? 1)),
  };
}

export function overlayPageUrl(base: string, params: OverlayImageParams): string {
  const query = new URLSearchParams({ name: params.name });
  if (params.period !== "recent") query.set("period", params.period);
  if (params.period === "today") query.set("tz", params.tz);
  if (params.rows !== undefined) query.set("rows", String(params.rows));
  if (params.title) query.set("title", params.title);
  if (params.avatar) query.set("avatar", params.avatar);
  // Scale is applied by the viewport below so the PNG stays sharp; the page
  // itself renders at scale 1.
  return `${base.replace(/\/$/, "")}/overlay?${query}`;
}

export const overlayCacheKey = (params: OverlayImageParams) => JSON.stringify(params);

// The page is served by this same process; localhost inside the container is
// the shortest path. OVERLAY_RENDER_BASE_URL overrides for dev or unusual
// deployments.
export const renderBaseUrl = () => (process.env.OVERLAY_RENDER_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const CHROMIUM_CANDIDATES = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  // macOS development fallbacks; production uses the Alpine chromium above.
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

async function screenshotOverlay(params: OverlayImageParams): Promise<Buffer> {
  const { chromium } = await import("playwright-core");
  const executablePath = process.env.CHROMIUM_PATH ?? CHROMIUM_CANDIDATES.find((path) => existsSync(path));
  if (!executablePath) throw new Error("No chromium executable found; set CHROMIUM_PATH");

  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 1900 },
      deviceScaleFactor: Math.max(0.4, Math.min(3, 2 * params.scale)),
    });
    await page.goto(overlayPageUrl(renderBaseUrl(), params), { waitUntil: "domcontentloaded", timeout: 20_000 });
    // The component stamps data-overlay-ready once the archive answered
    // (with data or with an error), so the screenshot never captures the
    // "Contacting the Ledger…" placeholder.
    await page.waitForSelector("[data-overlay-ready]", { timeout: 20_000 });
    const panel = page.locator("[data-overlay-root]");
    // Grow the viewport to the rendered panel so tall today/cycle windows
    // are captured whole — the PNG always matches the page.
    const box = await panel.boundingBox();
    if (box && box.height + 80 > 1900) {
      await page.setViewportSize({ width: 1000, height: Math.min(9000, Math.ceil(box.height) + 80) });
    }
    return Buffer.from(await panel.screenshot({ type: "png", omitBackground: true }));
  } finally {
    await browser.close();
  }
}

const TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 50;
const globalStore = globalThis as typeof globalThis & {
  __overlayPngCache?: Map<string, { expires: number; png: Buffer }>;
  __overlayPngInflight?: Map<string, Promise<Buffer>>;
};
const cache = globalStore.__overlayPngCache ??= new Map();
const inflight = globalStore.__overlayPngInflight ??= new Map();

export async function renderOverlayPng(params: OverlayImageParams, now = Date.now()): Promise<Buffer> {
  const key = overlayCacheKey(params);
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.png;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = screenshotOverlay(params)
    .then((png) => {
      cache.set(key, { expires: Date.now() + TTL_MS, png });
      if (cache.size > MAX_CACHE_ENTRIES) {
        for (const [candidate, entry] of cache) {
          if (entry.expires <= Date.now() || cache.size > MAX_CACHE_ENTRIES) cache.delete(candidate);
        }
      }
      return png;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
