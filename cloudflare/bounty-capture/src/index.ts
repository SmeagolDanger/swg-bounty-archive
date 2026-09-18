import {
  CAPTURE_PREFIX, HEARTBEAT_KEY, LATEST_KEY,
  captureKey, captureTimeFromKey, decideStandbyCapture, looksLikeBountyPayload, parseDate, sha256Hex, tokenMatches,
  type Heartbeat, type LatestState,
} from "./capture";

// Cold standby for the SWG Legends bounty feed. The primary collector (the
// archive's worker) sends a heartbeat after every poll that archived the
// bounty source. While heartbeats are fresh this worker does nothing. When
// they stop, the cron fetches the bounty endpoint on the primary's cadence and
// stores each new payload in a private R2 bucket. After the outage the
// archive replays the stored payloads (`npm run ingest:replay`), so an outage
// no longer creates an unrecoverable gap in the 12-row rolling window.

export interface Env {
  CAPTURES: R2Bucket;
  SWG_BASE_URL: string;
  STALE_AFTER_SECONDS?: string;
  CAPTURE_TOKEN: string;
}

interface CaptureOutcome { stored: boolean; key: string | null; reason: string; fetchedAt?: string | null }

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try { return await object.json<T>(); } catch { return null; }
}

async function fetchBounty(env: Env): Promise<{ status: number; text: string }> {
  const response = await fetch(`${env.SWG_BASE_URL.replace(/\/$/, "")}/api/game/bounty-hunting`, {
    headers: { Accept: "application/json", "User-Agent": "SWG-Bounty-Archive/1.0 (+public-data-archiver; standby)" },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, text: response.ok ? await response.text() : "" };
}

async function capture(env: Env, now: Date, trigger: "cron" | "manual"): Promise<CaptureOutcome> {
  const latest = await readJson<LatestState>(env.CAPTURES, LATEST_KEY);
  const response = await fetchBounty(env);
  if (response.status !== 200) return { stored: false, key: null, reason: `http_${response.status}` };
  let payload: unknown;
  try { payload = JSON.parse(response.text); } catch { return { stored: false, key: null, reason: "invalid_json" }; }
  if (!looksLikeBountyPayload(payload)) return { stored: false, key: null, reason: "unexpected_shape" };

  const sha256 = await sha256Hex(response.text);
  const fetchedAt = typeof payload.fetchedAt === "string" ? payload.fetchedAt : null;
  const state: LatestState = {
    checkedAt: now.toISOString(),
    storedAt: latest?.storedAt ?? null,
    key: latest?.key ?? null,
    sha256: latest?.sha256 ?? null,
    fetchedAt: latest?.fetchedAt ?? null,
  };
  if (latest?.sha256 === sha256) {
    await env.CAPTURES.put(LATEST_KEY, JSON.stringify(state));
    return { stored: false, key: latest.key, reason: "unchanged", fetchedAt };
  }
  const key = captureKey(now, sha256);
  await env.CAPTURES.put(key, response.text, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256, trigger, ...(fetchedAt ? { fetchedAt } : {}) },
  });
  await env.CAPTURES.put(LATEST_KEY, JSON.stringify({ ...state, storedAt: now.toISOString(), key, sha256, fetchedAt }));
  return { stored: true, key, reason: "stored", fetchedAt };
}

async function standbyStatus(env: Env, now: Date) {
  const [heartbeat, latest] = await Promise.all([
    readJson<Heartbeat>(env.CAPTURES, HEARTBEAT_KEY),
    readJson<LatestState>(env.CAPTURES, LATEST_KEY),
  ]);
  const heartbeatAt = heartbeat?.at ? new Date(heartbeat.at) : null;
  const lastCheckedAt = latest?.checkedAt ? new Date(latest.checkedAt) : null;
  const staleAfterSeconds = Number(env.STALE_AFTER_SECONDS) || undefined;
  const decision = decideStandbyCapture({ now, heartbeatAt, lastCheckedAt, staleAfterSeconds });
  return { heartbeatAt, lastCheckedAt, latest, decision };
}

function authorized(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  return tokenMatches(presented, env.CAPTURE_TOKEN);
}

async function listCaptures(env: Env, since: Date | null, until: Date | null) {
  const items: Array<{ key: string; capturedAt: string; size: number; sha256: string | null; fetchedAt: string | null; trigger: string | null }> = [];
  let cursor: string | undefined;
  do {
    const page = await env.CAPTURES.list({ prefix: CAPTURE_PREFIX, cursor, include: ["customMetadata"] });
    for (const object of page.objects) {
      const capturedAt = captureTimeFromKey(object.key);
      if (!capturedAt) continue;
      if (since && capturedAt < since) continue;
      if (until && capturedAt > until) continue;
      items.push({
        key: object.key, capturedAt: capturedAt.toISOString(), size: object.size,
        sha256: object.customMetadata?.sha256 ?? null, fetchedAt: object.customMetadata?.fetchedAt ?? null, trigger: object.customMetadata?.trigger ?? null,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  items.sort((a, b) => a.key.localeCompare(b.key));
  return items;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    const now = new Date();
    const status = await standbyStatus(env, now);
    if (!status.decision.capture) return;
    context.waitUntil((async () => {
      const outcome = await capture(env, now, "cron");
      console.log(JSON.stringify({ event: "standby_capture", standby_reason: status.decision.reason, ...outcome, heartbeatAt: status.heartbeatAt?.toISOString() ?? null }));
    })());
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.CAPTURE_TOKEN) return json({ error: "CAPTURE_TOKEN secret is not set" }, 503);
    if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
    const url = new URL(request.url);
    const now = new Date();

    if (request.method === "POST" && url.pathname === "/heartbeat") {
      let source = "primary";
      try { source = String(((await request.json()) as { source?: unknown })?.source ?? source).slice(0, 40); } catch { /* body optional */ }
      await env.CAPTURES.put(HEARTBEAT_KEY, JSON.stringify({ at: now.toISOString(), source } satisfies Heartbeat));
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/capture") {
      return json(await capture(env, now, "manual"));
    }
    if (request.method === "GET" && url.pathname === "/status") {
      const status = await standbyStatus(env, now);
      return json({
        now: now.toISOString(),
        heartbeatAt: status.heartbeatAt?.toISOString() ?? null,
        heartbeatAgeSeconds: status.heartbeatAt ? Math.round((now.getTime() - status.heartbeatAt.getTime()) / 1000) : null,
        standby: status.decision,
        lastCheckedAt: status.latest?.checkedAt ?? null,
        lastStoredAt: status.latest?.storedAt ?? null,
        lastStoredKey: status.latest?.key ?? null,
      });
    }
    if (request.method === "GET" && url.pathname === "/captures") {
      const since = parseDate(url.searchParams.get("since"));
      const until = parseDate(url.searchParams.get("until"));
      if (since === "invalid" || until === "invalid") return json({ error: "since/until must be ISO-8601 timestamps" }, 400);
      return json({ captures: await listCaptures(env, since, until) });
    }
    if (request.method === "GET" && url.pathname.startsWith(`/${CAPTURE_PREFIX}`)) {
      const key = url.pathname.slice(1);
      if (!captureTimeFromKey(key)) return json({ error: "Not found" }, 404);
      const object = await env.CAPTURES.get(key);
      if (!object) return json({ error: "Not found" }, 404);
      return new Response(object.body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
