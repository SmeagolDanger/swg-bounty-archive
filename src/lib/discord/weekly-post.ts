import { existsSync } from "node:fs";
import { pool } from "../db/client";
import { errorLogContext, log } from "../observability/logger";

// Posts the finished weekly cycle's report image to a Discord webhook once
// per cycle. The worker calls maybePostWeeklyReport after every poll; the
// decision function keeps the trigger logic pure and testable.

export interface WeeklyPostCycle {
  starts_at: Date | string;
  ends_at: Date | string;
}

export interface WeeklyPostDecision {
  post: boolean;
  reason: string;
  cycleStart?: Date;
  cycleEnd?: Date;
}

export function decideWeeklyPost(input: {
  now: Date;
  cycles: WeeklyPostCycle[];       // newest first
  alreadyPosted: Set<string>;      // ISO cycle starts
  settleMinutes?: number;
}): WeeklyPostDecision {
  if (input.cycles.length < 2) return { post: false, reason: "not_enough_cycles" };
  const [current, previous] = input.cycles;
  const settleMs = (input.settleMinutes ?? 30) * 60_000;
  if (input.now.getTime() - new Date(current.starts_at).getTime() < settleMs) {
    return { post: false, reason: "reset_settling" };
  }
  const cycleStart = new Date(previous.starts_at);
  const cycleEnd = new Date(previous.ends_at);
  if (input.now.getTime() - cycleEnd.getTime() > 8 * 86_400_000) {
    return { post: false, reason: "cycle_too_old" };
  }
  if (input.alreadyPosted.has(cycleStart.toISOString())) {
    return { post: false, reason: "already_posted" };
  }
  return { post: true, reason: "due", cycleStart, cycleEnd };
}

export async function maybePostWeeklyReport(): Promise<void> {
  const webhook = process.env.DISCORD_REPORT_WEBHOOK_URL;
  if (!webhook) return;

  const cycles = await pool.query<WeeklyPostCycle>(
    `SELECT DISTINCT starts_at, ends_at FROM leaderboard_periods
     WHERE leaderboard_id='BOUNTY_HUNTER_GROUND_VALUE'
     ORDER BY starts_at DESC LIMIT 3`,
  );
  const posted = await pool.query<{ cycle_starts_at: Date }>("SELECT cycle_starts_at FROM discord_report_posts");
  const decision = decideWeeklyPost({
    now: new Date(),
    cycles: cycles.rows,
    alreadyPosted: new Set(posted.rows.map((row) => new Date(row.cycle_starts_at).toISOString())),
  });
  if (!decision.post || !decision.cycleStart || !decision.cycleEnd) return;

  try {
    const png = await renderShareCard(decision.cycleStart);
    await postToDiscord(webhook, png, decision.cycleStart, decision.cycleEnd);
    await pool.query(
      "INSERT INTO discord_report_posts(cycle_starts_at, cycle_ends_at) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [decision.cycleStart, decision.cycleEnd],
    );
    log.info("discord_report_posted", {
      source: "discord_report", status: "success",
      cycle_starts_at: decision.cycleStart.toISOString(), cycle_ends_at: decision.cycleEnd.toISOString(),
    });
  } catch (error) {
    log.warn("discord_report_failed", {
      source: "discord_report", status: "failed",
      cycle_starts_at: decision.cycleStart.toISOString(), ...errorLogContext(error),
    });
  }
}

async function renderShareCard(cycleStart: Date): Promise<Buffer> {
  const { chromium } = await import("playwright-core");
  const base = (process.env.REPORT_SHARE_BASE_URL ?? "http://web:3000").replace(/\/$/, "");
  const executablePath = process.env.CHROMIUM_PATH
    ?? ["/usr/bin/chromium-browser", "/usr/bin/chromium"].find((path) => existsSync(path));
  if (!executablePath) throw new Error("No chromium executable found; set CHROMIUM_PATH");

  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 2400 }, deviceScaleFactor: 2 });
    await page.goto(
      `${base}/reports/weekly/share-card?cycle=${encodeURIComponent(cycleStart.toISOString())}`,
      { waitUntil: "networkidle", timeout: 45_000 },
    );
    const card = page.locator("[data-report-share]");
    await card.waitFor({ state: "visible", timeout: 15_000 });
    return Buffer.from(await card.screenshot({ type: "png" }));
  } finally {
    await browser.close();
  }
}

async function postToDiscord(webhook: string, png: Buffer, start: Date, end: Date): Promise<void> {
  const day = (value: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(value);
  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    content: `**Weekly Cycle Report** — ${day(start)} → ${day(end)} · <https://jawatracks.com/reports/weekly>`,
    attachments: [{ id: 0, filename: "weekly-report.png" }],
  }));
  form.append("files[0]", new Blob([new Uint8Array(png)], { type: "image/png" }), "weekly-report.png");
  const response = await fetch(webhook, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}
