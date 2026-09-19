import { statfs } from "node:fs/promises";
import { errorLogContext, log } from "./logger";

// Hourly free-space check from inside the worker container. The container's
// root filesystem sits on the host's Docker partition, so this catches the
// host disk filling up (logs, dumps, database growth) before Postgres starts
// failing writes. Never throws.

export const DISK_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const DISK_MIN_FREE_BYTES = 2 * 1024 ** 3;
export const DISK_MIN_FREE_RATIO = 0.10;

export interface DiskAssessment { low: boolean; free_bytes: number; total_bytes: number; free_ratio: number; free_gb: number; total_gb: number }

export function assessDisk(freeBytes: number, totalBytes: number): DiskAssessment {
  const ratio = totalBytes > 0 ? freeBytes / totalBytes : 1;
  const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;
  return {
    low: totalBytes > 0 && (freeBytes < DISK_MIN_FREE_BYTES || ratio < DISK_MIN_FREE_RATIO),
    free_bytes: freeBytes, total_bytes: totalBytes, free_ratio: Math.round(ratio * 1000) / 1000, free_gb: gb(freeBytes), total_gb: gb(totalBytes),
  };
}

export interface DiskCheckDeps {
  path?: string;
  statfsImpl?: typeof statfs;
}

export async function checkDiskSpace(deps: DiskCheckDeps = {}): Promise<DiskAssessment | null> {
  const path = deps.path ?? "/";
  try {
    const stats = await (deps.statfsImpl ?? statfs)(path);
    const assessment = assessDisk(Number(stats.bavail) * Number(stats.bsize), Number(stats.blocks) * Number(stats.bsize));
    if (assessment.low) {
      log.warn("host_disk_low", { source: "host", status: "failed", reason: "disk_space_low", path, ...assessment });
    }
    return assessment;
  } catch (error) {
    log.warn("host_disk_low", { source: "host", status: "failed", reason: "disk_check_failed", path, ...errorLogContext(error) });
    return null;
  }
}

let lastCheckedAt: number | null = null;

// Called every worker cycle; only does work once per DISK_CHECK_INTERVAL_MS.
export async function maybeCheckDiskSpace(now = Date.now(), deps: DiskCheckDeps = {}): Promise<void> {
  if (lastCheckedAt !== null && now - lastCheckedAt < DISK_CHECK_INTERVAL_MS) return;
  lastCheckedAt = now;
  await checkDiskSpace(deps);
}

export function resetDiskCheckSchedule(): void { lastCheckedAt = null; }
