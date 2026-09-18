import { errorLogContext, log } from "../observability/logger";

// Tells the Cloudflare standby capture worker that the primary collector just
// archived the bounty feed. While these arrive the standby stays idle; when
// they stop it starts capturing on its own. Never throws: a standby problem
// must not affect ingestion.

export interface HeartbeatDeps {
  url?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export type HeartbeatResult = "sent" | "disabled" | "failed";

export function standbyEndpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export async function sendCaptureHeartbeat(deps: HeartbeatDeps = {}): Promise<HeartbeatResult> {
  const url = (deps.url ?? process.env.CAPTURE_STANDBY_URL)?.trim();
  const token = (deps.token ?? process.env.CAPTURE_STANDBY_TOKEN)?.trim();
  if (!url || !token) return "disabled";
  try {
    const response = await (deps.fetchImpl ?? fetch)(standbyEndpoint(url, "/heartbeat"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: "worker" }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Capture standby returned HTTP ${response.status}`);
    return "sent";
  } catch (error) {
    log.warn("capture_heartbeat_failed", { source: "capture_standby", status: "failed", ...errorLogContext(error) });
    return "failed";
  }
}
