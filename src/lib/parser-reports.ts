import { z } from "zod";
import { errorLogContext, log } from "./observability/logger";

// BattleTrace (the desktop combat-log analyzer) can send the structural shapes
// of [Combat] lines its parser did not recognize. Shapes are already redacted
// client-side (numbers → #, capitalized names → <name>, timestamp dropped);
// this module validates them and forwards a summary to a private Discord
// channel. Nothing is written to the archive.

export const MAX_SHAPES = 50;
export const MAX_BODY_BYTES = 64 * 1024;
const DISCORD_CONTENT_LIMIT = 2000;

export const parserReportSchema = z.object({
  app: z.literal("battletrace"),
  version: z.string().trim().min(1).max(40),
  analysisVersion: z.string().trim().max(120).optional(),
  combatLineCount: z.number().int().min(0).max(100_000_000),
  unsupportedLineCount: z.number().int().min(0).max(100_000_000),
  shapes: z.array(z.object({
    shape: z.string().trim().min(1).max(400),
    count: z.number().int().min(1).max(100_000_000),
  })).min(1).max(MAX_SHAPES),
});

export type ParserReport = z.infer<typeof parserReportSchema>;

const n = (value: number) => value.toLocaleString("en-US");

export function formatParserReport(report: ParserReport, now = new Date()): string {
  const stamp = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const header = `**BattleTrace parser report** · v${report.version} · ${n(report.unsupportedLineCount)} of ${n(report.combatLineCount)} combat lines unrecognized · ${stamp}`;
  const lines = [...report.shapes]
    .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape))
    .map((item) => `${String(item.count).padStart(4)}× ${item.shape.replace(/```/g, "'''")}`);
  let body = "";
  let shown = 0;
  for (const line of lines) {
    const candidate = body ? `${body}\n${line}` : line;
    if (header.length + candidate.length + 60 > DISCORD_CONTENT_LIMIT) break;
    body = candidate;
    shown += 1;
  }
  const omitted = lines.length - shown;
  const footer = omitted ? `\n…and ${omitted} more shape${omitted === 1 ? "" : "s"}.` : "";
  return `${header}\n\`\`\`\n${body}\n\`\`\`${footer}`;
}

export interface ParserReportDeps {
  webhook?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export async function handleParserReport(request: Request, deps: ParserReportDeps = {}): Promise<Response> {
  const webhook = deps.webhook ?? process.env.PARSER_REPORT_WEBHOOK_URL?.trim();
  if (!webhook) return Response.json({ error: "Parser reports are not enabled on this server" }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Report too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: "Report too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = parserReportSchema.safeParse(body);
  if (!parsed.success) {
    log.info("parser_report_rejected", { source: "parser_report", status: "rejected", issue_count: parsed.error.issues.length });
    return Response.json(
      { error: "Invalid report", issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`) },
      { status: 400 },
    );
  }
  const content = formatParserReport(parsed.data, deps.now?.() ?? new Date());
  try {
    const response = await (deps.fetchImpl ?? fetch)(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No mention parsing: a crafted shape must never ping the channel.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
  } catch (error) {
    log.warn("parser_report_failed", { source: "parser_report", status: "failed", ...errorLogContext(error) });
    return Response.json({ error: "Could not deliver the report" }, { status: 502 });
  }
  log.info("parser_report_received", {
    source: "parser_report",
    status: "success",
    app_version: parsed.data.version,
    shape_count: parsed.data.shapes.length,
    unsupported_line_count: parsed.data.unsupportedLineCount,
  });
  return Response.json({ accepted: true, shapes: parsed.data.shapes.length }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
