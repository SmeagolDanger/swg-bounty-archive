import { describe, expect, it, vi } from "vitest";
import { sendCollectorHeartbeat } from "./heartbeat";
import { log } from "./logger";

describe("optional collector heartbeat", () => {
  it("does nothing when monitoring is disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await sendCollectorHeartbeat("SUCCEEDED", { fetchImpl, heartbeatUrl: "" })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports success only to the base heartbeat URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    expect(await sendCollectorHeartbeat("SUCCEEDED", { fetchImpl, heartbeatUrl: "https://heartbeat.test/token" })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("https://heartbeat.test/token", expect.objectContaining({ method: "GET" }));
  });

  it.each(["PARTIAL", "FAILED"] as const)("reports %s via the failure URL", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    expect(await sendCollectorHeartbeat(status, { fetchImpl, heartbeatUrl: "https://heartbeat.test/token/" })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("https://heartbeat.test/token/fail", expect.anything());
  });

  it("swallows heartbeat transport failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("monitor offline"));
    const warning = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await expect(sendCollectorHeartbeat("SUCCEEDED", { fetchImpl, heartbeatUrl: "https://heartbeat.test/token" })).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith("betterstack_heartbeat_failed", expect.objectContaining({ errorCode: "HEARTBEAT_FAILED" }));
    warning.mockRestore();
  });
});
