import { TRACKED_BOARD_IDS } from "./config";

export type SourceProcessor = "catalog" | "bounty" | "leaderboard" | "wins" | "officers";

export interface IntegrityIssue {
  event: "pagination_incomplete" | "source_integrity_failed";
  reason: string;
  expected_records?: number;
  received_records?: number;
  missing_fields?: string[];
}

export interface SourceIntegrity {
  expected_records: number;
  received_records: number;
  issues: IntegrityIssue[];
}

export type IngestionStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export function classifyRunStatus(requests: number, failedSources: number, partialSources: number): IngestionStatus {
  if (requests > 0 && failedSources >= requests) return "FAILED";
  if (failedSources > 0 || partialSources > 0) return "PARTIAL";
  return "SUCCEEDED";
}

export function isDatabaseFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code))
    || (typeof candidate.name === "string" && /postgres|database/i.test(candidate.name));
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function paginationIssue(payload: Record<string, unknown>): IntegrityIssue | null {
  const metadata = object(payload.pagination) ?? payload;
  const expectedPages = finiteNumber(metadata.totalPages ?? metadata.total_pages);
  const receivedPages = finiteNumber(metadata.pagesReceived ?? metadata.pages_received ?? metadata.currentPage ?? metadata.current_page);
  const explicitlyIncomplete = metadata.complete === false || metadata.isComplete === false || metadata.is_complete === false;
  if (!explicitlyIncomplete && !(expectedPages !== null && receivedPages !== null && receivedPages < expectedPages)) return null;
  return {
    event: "pagination_incomplete",
    reason: "pagination_incomplete",
    ...(expectedPages === null ? {} : { expected_records: expectedPages }),
    ...(receivedPages === null ? {} : { received_records: receivedPages }),
  };
}

export function assessSourceIntegrity(processor: SourceProcessor, payload: unknown): SourceIntegrity {
  const root = object(payload);
  if (!root) {
    return {
      expected_records: 1,
      received_records: 0,
      issues: [{ event: "source_integrity_failed", reason: "non_object_response", expected_records: 1, received_records: 0 }],
    };
  }

  const issues: IntegrityIssue[] = [];
  const pagination = paginationIssue(root);
  if (pagination) issues.push(pagination);

  if (processor === "catalog") {
    const boards = Array.isArray(root.boards) ? root.boards : [];
    const ids = new Set(boards.map((entry) => object(entry)?.id).filter((id): id is string => typeof id === "string"));
    const missing = TRACKED_BOARD_IDS.filter((id) => !ids.has(id));
    if (missing.length) {
      issues.push({ event: "source_integrity_failed", reason: "tracked_boards_missing", missing_fields: missing });
    }
    return { expected_records: Math.max(boards.length, TRACKED_BOARD_IDS.length), received_records: boards.length, issues };
  }

  if (processor === "bounty") {
    const summary = object(root.summary);
    const archiveEncounters = finiteNumber(summary?.encounters) ?? 0;
    const recent = arrayLength(root.recent);
    // The public endpoint intentionally exposes only its 12 newest events.
    const expectedRecent = Math.min(archiveEncounters, 12);
    if (recent < expectedRecent) {
      issues.push({
        event: "source_integrity_failed",
        reason: recent === 0 ? "unexpected_empty_response" : "recent_encounters_incomplete",
        expected_records: expectedRecent,
        received_records: recent,
      });
    }
    return { expected_records: expectedRecent + 1, received_records: recent + 1, issues };
  }

  if (processor === "officers") {
    const received = arrayLength(root.officers);
    const total = finiteNumber(root.totalResults) ?? 0;
    // Officers' Salute is publicly capped at 250 rows per faction.
    const expected = Math.min(total, 250);
    if (received < expected) {
      issues.push({
        event: "source_integrity_failed",
        reason: received === 0 ? "unexpected_empty_response" : "officer_registry_incomplete",
        expected_records: expected,
        received_records: received,
      });
    }
    return { expected_records: expected, received_records: received, issues };
  }

  if (processor === "leaderboard") {
    const received = arrayLength(root.entries);
    return { expected_records: received, received_records: received, issues };
  }

  const received = arrayLength(root.cityWins) + arrayLength(root.guildWins);
  return { expected_records: received, received_records: received, issues };
}
