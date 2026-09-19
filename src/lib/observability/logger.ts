import { publishToAxiom } from "./axiom";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type ObservabilityEvent =
  | "ingestion_started"
  | "ingestion_complete"
  | "ingestion_run_complete"
  | "api_http_error"
  | "api_transport_error"
  | "api_timeout"
  | "api_rate_limited"
  | "source_processing_failed"
  | "source_validation_failed"
  | "source_schema_changed"
  | "source_fields_changed"
  | "database_transaction_failed"
  | "pagination_incomplete"
  | "worker_started"
  | "worker_stopped"
  | "discord_report_posted"
  | "discord_report_failed"
  | "discord_bounty_posted"
  | "discord_bounty_failed"
  | "discord_bounty_bootstrapped"
  | "capture_heartbeat_failed"
  | "capture_replay_complete"
  | "discord_feed_backlog"
  | "host_disk_low"
  | "discord_interaction_answered"
  | "discord_interaction_failed"
  | "discord_interaction_rejected"
  | "overlay_image_failed"
  | "parser_report_received"
  | "parser_report_rejected"
  | "parser_report_failed";

export type LogContext = Record<string, unknown>;

const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const sensitiveKey = /authorization|cookie|password|secret|token|database_?url|connection_?string|admin_password|response_headers|request_headers/i;
const forbiddenPayloadKey = /(^|_)(payload|raw|body)$/i;

function sanitizeString(value: string): string {
  return value
    .replace(/\bpostgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTED]")
    .replace(/\b(token|password|secret|api[_-]?key)=([^\s&]+)/gi, "$1=[REDACTED]");
}

function sanitize(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (sensitiveKey.test(key) || forbiddenPayloadKey.test(key)) return "[REDACTED]";
  if (value instanceof Error) return {
    name: value.name,
    message: sanitizeString(value.message),
    stack: value.stack ? sanitizeString(value.stack) : undefined,
  };
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key, seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitize(child, childKey, seen)]));
}

// ------------------------------------------------------------------- alerts
//
// Axiom's free plan allows only a few monitors, so alert-worthy events are
// classified here and carry `alert` (a stable name) and `alert_summary` (one
// readable line). A single match monitor on `isnotempty(alert)` then pages
// for everything, and adding a new alert is a code change, not a new monitor.
// Per-source failures inside a run are deliberately not alerts: the run's
// own `ingestion_run_complete` (failed/partial) covers them once.

export interface AlertClassification { alert: string; alert_summary: string }

const RUN_COVERED_EVENTS = new Set<ObservabilityEvent>([
  "source_validation_failed", "source_processing_failed", "api_http_error", "api_transport_error", "api_timeout", "api_rate_limited",
  "ingestion_complete", "overlay_image_failed", "parser_report_failed", "parser_report_rejected", "discord_interaction_rejected",
]);

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" ? value : undefined);

function alertName(level: LogLevel, event: ObservabilityEvent, context: Record<string, unknown>): string | undefined {
  const status = str(context.status);
  const reason = str(context.reason);
  if (str(context.source) === "monitoring_test") return "monitoring_test";
  switch (event) {
    case "ingestion_run_complete":
      return status === "failed" ? "ingestion_failed" : status === "partial" ? "ingestion_partial" : undefined;
    case "source_schema_changed":
    case "source_fields_changed":
      return "source_changed";
    case "pagination_incomplete":
      return "pagination_incomplete";
    case "database_transaction_failed":
      return "database_failure";
    case "source_processing_failed":
      return reason === "worker_cycle_aborted" ? "worker_cycle_aborted" : undefined;
    case "discord_bounty_failed": {
      if (reason === "publisher_error") return "discord_feed_error";
      const http = num(context.http_status);
      // 4xx other than rate limiting means the webhook is gone or revoked; 5xx and network errors retry on their own.
      return http !== undefined && http >= 400 && http < 500 && http !== 429 ? "discord_webhook_rejected" : undefined;
    }
    case "discord_report_failed":
      return "weekly_report_failed";
    case "discord_interaction_failed":
      return "discord_bot_error";
    case "capture_heartbeat_failed":
      return "standby_unreachable";
    case "discord_feed_backlog":
      return "discord_feed_backlog";
    case "host_disk_low":
      return "host_disk_low";
    case "capture_replay_complete":
      return status === "failed" ? "replay_failed" : undefined;
    default:
      return level === "error" && !RUN_COVERED_EVENTS.has(event) ? event : undefined;
  }
}

export function classifyAlert(level: LogLevel, event: ObservabilityEvent, context: Record<string, unknown>): AlertClassification | undefined {
  const alert = alertName(level, event, context);
  if (!alert) return undefined;
  const message = str(context.error_message) ?? str(context.message);
  const parts = [
    event,
    str(context.source) && str(context.source) !== "all" ? `source=${str(context.source)}` : undefined,
    str(context.status) ? `status=${str(context.status)}` : undefined,
    str(context.reason) ? `reason=${str(context.reason)}` : Array.isArray(context.reason) ? `reason=${(context.reason as unknown[]).join(",")}` : undefined,
    num(context.http_status) !== undefined ? `http=${num(context.http_status)}` : undefined,
    num(context.failed_sources) ? `failed_sources=${num(context.failed_sources)}` : undefined,
    num(context.pending) !== undefined ? `pending=${num(context.pending)}` : undefined,
    num(context.free_gb) !== undefined ? `free=${num(context.free_gb)}GB` : undefined,
    message ? message.replace(/\s+/g, " ").slice(0, 160) : undefined,
  ].filter(Boolean);
  return { alert, alert_summary: parts.join(" · ") };
}

export function structuredLogRecord(level: LogLevel, event: ObservabilityEvent, context: LogContext = {}, now = new Date()): Record<string, unknown> {
  const sanitized = sanitize(context) as Record<string, unknown>;
  return {
    ...sanitized,
    ...(classifyAlert(level, event, sanitized) ?? {}),
    timestamp: now.toISOString(),
    level,
    event,
    environment: process.env.AXIOM_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    service: "outer-rim-ledger",
  };
}

export function errorLogContext(error: unknown): Record<string, unknown> {
  const source = error instanceof Error ? error : new Error(String(error));
  return {
    error_type: source.name,
    error_message: source.message,
    ...(source.stack ? { stack_trace: source.stack } : {}),
  };
}

function enabled(level: LogLevel): boolean {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return levels[level] >= (levels[configured] ?? levels.info);
}

function write(level: LogLevel, event: ObservabilityEvent, context?: LogContext): void {
  if (!enabled(level)) return;
  try {
    const record = structuredLogRecord(level, event, context);
    const line = `${JSON.stringify(record)}\n`;
    if (level === "error" || level === "warn") process.stderr.write(line);
    else process.stdout.write(line);
    publishToAxiom(record);
  } catch {
    // Observability must never become an ingestion dependency.
  }
}

export const log = {
  debug: (event: ObservabilityEvent, context?: LogContext) => write("debug", event, context),
  info: (event: ObservabilityEvent, context?: LogContext) => write("info", event, context),
  warn: (event: ObservabilityEvent, context?: LogContext) => write("warn", event, context),
  error: (event: ObservabilityEvent, context?: LogContext) => write("error", event, context),
};
