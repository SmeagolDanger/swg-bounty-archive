export type LogLevel = "debug" | "info" | "warn" | "error";

export type ObservabilityEvent =
  | "ingestion_run_started"
  | "ingestion_run_succeeded"
  | "ingestion_run_partial"
  | "ingestion_run_failed"
  | "swg_api_http_error"
  | "swg_api_transport_error"
  | "swg_api_timeout"
  | "swg_api_processing_failed"
  | "swg_api_validation_failed"
  | "swg_api_schema_changed"
  | "swg_api_unknown_fields"
  | "worker_started"
  | "worker_stopped"
  | "betterstack_heartbeat_failed";

export type LogContext = Record<string, unknown>;

const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const sensitiveKey = /authorization|cookie|password|secret|token|database_?url|connection_?string|admin_password|response_headers|request_headers/i;
const forbiddenPayloadKey = /(^|_)(payload|raw|body)$/i;

function sanitizeString(value: string): string {
  return value
    .replace(/\bpostgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTED]");
}

function sanitize(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (sensitiveKey.test(key) || forbiddenPayloadKey.test(key)) return "[REDACTED]";
  if (value instanceof Error) return { name: value.name, message: sanitizeString(value.message) };
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key, seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitize(child, childKey, seen)]));
}

export function structuredLogRecord(level: LogLevel, event: ObservabilityEvent, context: LogContext = {}, now = new Date()): Record<string, unknown> {
  return { ...sanitize(context) as Record<string, unknown>, timestamp: now.toISOString(), level, event };
}

function enabled(level: LogLevel): boolean {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return levels[level] >= (levels[configured] ?? levels.info);
}

function write(level: LogLevel, event: ObservabilityEvent, context?: LogContext): void {
  if (!enabled(level)) return;
  try {
    const line = `${JSON.stringify(structuredLogRecord(level, event, context))}\n`;
    if (level === "error" || level === "warn") process.stderr.write(line);
    else process.stdout.write(line);
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
