import { log } from "./logger";

export type CollectorHeartbeatStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface HeartbeatOptions {
  fetchImpl?: typeof fetch;
  heartbeatUrl?: string;
  timeoutMs?: number;
}

function failureUrl(url: string): string {
  return `${url.replace(/\/$/, "")}/fail`;
}

export async function sendCollectorHeartbeat(status: CollectorHeartbeatStatus, options: HeartbeatOptions = {}): Promise<boolean> {
  const heartbeatUrl = options.heartbeatUrl ?? process.env.BETTERSTACK_HEARTBEAT_URL;
  if (!heartbeatUrl) return false;
  const configuredTimeout = options.timeoutMs ?? Number(process.env.BETTERSTACK_HEARTBEAT_TIMEOUT_MS ?? 3_000);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(500, Math.min(10_000, configuredTimeout)) : 3_000;
  const url = status === "SUCCEEDED" ? heartbeatUrl : failureUrl(heartbeatUrl);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Heartbeat returned HTTP ${response.status}`);
    return true;
  } catch (error) {
    log.warn("betterstack_heartbeat_failed", {
      heartbeatStatus: status,
      errorCode: error instanceof DOMException && error.name === "TimeoutError" ? "HEARTBEAT_TIMEOUT" : "HEARTBEAT_FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
