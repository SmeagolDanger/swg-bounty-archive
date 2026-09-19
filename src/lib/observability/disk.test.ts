import type { statfs } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "./logger";
import { DISK_CHECK_INTERVAL_MS, assessDisk, checkDiskSpace, maybeCheckDiskSpace, resetDiskCheckSchedule } from "./disk";

const GB = 1024 ** 3;
const fakeStatfs = (freeBytes: number, totalBytes: number) =>
  (async () => ({ bsize: 4096, blocks: totalBytes / 4096, bavail: freeBytes / 4096 })) as unknown as typeof statfs;

beforeEach(() => { vi.spyOn(log, "warn").mockImplementation(() => undefined); resetDiskCheckSchedule(); });
afterEach(() => vi.restoreAllMocks());

describe("assessDisk", () => {
  it("flags low space below 10% or 2 GB, whichever is larger", () => {
    expect(assessDisk(30 * GB, 80 * GB).low).toBe(false);
    expect(assessDisk(7 * GB, 80 * GB).low).toBe(true);     // 8.75%
    expect(assessDisk(1.5 * GB, 10 * GB).low).toBe(true);   // 15% but under 2 GB
    expect(assessDisk(3 * GB, 10 * GB).low).toBe(false);
    expect(assessDisk(0, 0).low).toBe(false);
    expect(assessDisk(7 * GB, 80 * GB)).toMatchObject({ free_gb: 7, total_gb: 80, free_ratio: 0.088 });
  });
});

describe("checkDiskSpace", () => {
  it("logs an alert-classified warning only when space is low", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await checkDiskSpace({ statfsImpl: fakeStatfs(40 * GB, 80 * GB) });
    expect(warn).not.toHaveBeenCalled();
    await checkDiskSpace({ path: "/", statfsImpl: fakeStatfs(1 * GB, 80 * GB) });
    expect(warn).toHaveBeenCalledWith("host_disk_low", expect.objectContaining({ reason: "disk_space_low", free_gb: 1, total_gb: 80, path: "/" }));
  });

  it("never throws when statfs fails", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const broken = (async () => { throw new Error("ENOSYS"); }) as unknown as typeof statfs;
    expect(await checkDiskSpace({ statfsImpl: broken })).toBeNull();
    expect(warn).toHaveBeenCalledWith("host_disk_low", expect.objectContaining({ reason: "disk_check_failed" }));
  });

  it("runs at most once per interval", async () => {
    const calls: number[] = [];
    const counting = (async () => { calls.push(1); return { bsize: 1, blocks: 100, bavail: 50 }; }) as unknown as typeof statfs;
    await maybeCheckDiskSpace(1_000_000, { statfsImpl: counting });
    await maybeCheckDiskSpace(1_000_000 + DISK_CHECK_INTERVAL_MS - 1, { statfsImpl: counting });
    await maybeCheckDiskSpace(1_000_000 + DISK_CHECK_INTERVAL_MS, { statfsImpl: counting });
    expect(calls).toHaveLength(2);
  });
});
