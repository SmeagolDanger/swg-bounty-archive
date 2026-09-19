// Pure helpers for the standby capture worker: no bindings, unit-testable.

export const CAPTURE_PREFIX = "captures/";
export const HEARTBEAT_KEY = "state/heartbeat.json";
export const LATEST_KEY = "state/latest.json";
export const ALERT_KEY = "state/alerts.json";
export const FAILURE_ALERT_INTERVAL_SECONDS = 3600;
export const DEFAULT_STALE_AFTER_SECONDS = 360;
// Mirrors the primary's cadence during a takeover; the source caches for 300 s.
export const MIN_CAPTURE_GAP_SECONDS = 290;

export interface Heartbeat { at: string; source?: string }
export interface LatestState {
  checkedAt: string;      // last time the standby fetched the source
  storedAt: string | null; // last time a new payload was written
  key: string | null;
  sha256: string | null;
  fetchedAt: string | null;
}

export type StandbyDecision =
  | { capture: false; reason: "primary_healthy" | "captured_recently" }
  | { capture: true; reason: "primary_stale" | "primary_never_seen" };

export function decideStandbyCapture(input: {
  now: Date;
  heartbeatAt: Date | null;
  lastCheckedAt: Date | null;
  staleAfterSeconds?: number;
}): StandbyDecision {
  const staleAfter = (input.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS) * 1000;
  if (input.heartbeatAt && input.now.getTime() - input.heartbeatAt.getTime() <= staleAfter) {
    return { capture: false, reason: "primary_healthy" };
  }
  if (input.lastCheckedAt && input.now.getTime() - input.lastCheckedAt.getTime() < MIN_CAPTURE_GAP_SECONDS * 1000) {
    return { capture: false, reason: "captured_recently" };
  }
  return { capture: true, reason: input.heartbeatAt ? "primary_stale" : "primary_never_seen" };
}

// captures/2026-09-18T20-05-00.123Z-1a2b3c4d.json: lexicographic order is time order.
export function captureKey(capturedAt: Date, sha256: string): string {
  return `${CAPTURE_PREFIX}${capturedAt.toISOString().replaceAll(":", "-")}-${sha256.slice(0, 8)}.json`;
}

export function captureTimeFromKey(key: string): Date | null {
  const match = /^captures\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}\.\d{3})Z-[0-9a-f]{8}\.json$/.exec(key);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseDate(value: string | null): Date | null | "invalid" {
  if (value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Constant-time comparison for the bearer token.
export function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented || !expected) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

// A payload is worth keeping only if it looks like the bounty feed.
export function looksLikeBountyPayload(value: unknown): value is { recent: unknown[]; fetchedAt?: string } {
  return typeof value === "object" && value !== null && Array.isArray((value as { recent?: unknown }).recent);
}

// ---------------------------------------------------------------- alerting
//
// Optional Discord notifications (ALERT_WEBHOOK_URL secret): one message when
// the standby takes over, one when the primary is back (with the replay
// command), and at most one per hour while the standby's own captures fail.

export interface AlertState {
  takeoverAt: string | null;          // set while the primary is considered down
  lastFailureAlertAt: string | null;
  capturesDuringTakeover: number;
}

export interface CaptureResult { stored: boolean; key: string | null; reason: string }

export interface AlertEmbed { color: number; title: string; description: string }

export const EMPTY_ALERT_STATE: AlertState = { takeoverAt: null, lastFailureAlertAt: null, capturesDuringTakeover: 0 };
const RED = 0xed4245, GREEN = 0x57f287, AMBER = 0xffaa00;

export function nextAlertState(input: {
  state: AlertState;
  decision: StandbyDecision;
  outcome: CaptureResult | null;
  heartbeatAt: Date | null;
  now: Date;
}): { state: AlertState; messages: AlertEmbed[] } {
  const { now } = input;
  const state: AlertState = { ...input.state };
  const messages: AlertEmbed[] = [];
  const primaryDown = input.decision.reason !== "primary_healthy";
  const fmt = (date: Date | string | null) => (date ? `<t:${Math.floor(new Date(date).getTime() / 1000)}:f>` : "never");

  if (primaryDown && !state.takeoverAt) {
    state.takeoverAt = now.toISOString();
    state.capturesDuringTakeover = 0;
    messages.push({
      color: RED,
      title: "Jawa Tracks collector is silent — standby capturing",
      description: `Last heartbeat: ${fmt(input.heartbeatAt)}.\nThe Cloudflare standby is now capturing the bounty feed every ~5 minutes so nothing is lost. Check the VPS: \`dc ps\`, \`dc logs --since 30m worker\`.`,
    });
  }
  if (input.outcome?.stored) state.capturesDuringTakeover += 1;

  if (!primaryDown && state.takeoverAt) {
    const since = state.takeoverAt;
    messages.push({
      color: GREEN,
      title: "Jawa Tracks collector is back",
      description: `Silent from ${fmt(since)} to ${fmt(now)}; standby stored ${state.capturesDuringTakeover} capture(s).\nReplay them into the archive:\n\`\`\`\ndc exec worker npm run ingest:replay -- --since ${since}\n\`\`\``,
    });
    state.takeoverAt = null;
    state.lastFailureAlertAt = null;
    state.capturesDuringTakeover = 0;
  }

  const failed = input.outcome && !input.outcome.stored && input.outcome.reason !== "unchanged";
  if (failed && primaryDown) {
    const last = state.lastFailureAlertAt ? new Date(state.lastFailureAlertAt).getTime() : 0;
    if (now.getTime() - last >= FAILURE_ALERT_INTERVAL_SECONDS * 1000) {
      state.lastFailureAlertAt = now.toISOString();
      messages.push({
        color: AMBER,
        title: "Standby capture is failing",
        description: `The standby could not capture the bounty feed (reason: \`${input.outcome!.reason}\`). While this persists, encounters older than the source's 12-row window are being lost. Get the primary collector back as soon as possible.`,
      });
    }
  }
  return { state, messages };
}
