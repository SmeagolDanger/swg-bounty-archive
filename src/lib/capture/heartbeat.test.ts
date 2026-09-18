import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/observability/logger";
import { sendCaptureHeartbeat, standbyEndpoint } from "./heartbeat";

function fakeFetch(status: number | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (status instanceof Error) throw status;
    return new Response(null, { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => { vi.spyOn(log, "warn").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe("sendCaptureHeartbeat", () => {
  it("is disabled without a URL and token", async () => {
    const { fetchImpl, calls } = fakeFetch(204);
    expect(await sendCaptureHeartbeat({ url: "", token: "t", fetchImpl })).toBe("disabled");
    expect(await sendCaptureHeartbeat({ url: "https://standby.test", token: " ", fetchImpl })).toBe("disabled");
    expect(calls).toHaveLength(0);
  });

  it("posts a bearer-authenticated heartbeat", async () => {
    const { fetchImpl, calls } = fakeFetch(204);
    expect(await sendCaptureHeartbeat({ url: "https://standby.test/", token: "secret", fetchImpl })).toBe("sent");
    expect(calls[0].url).toBe("https://standby.test/heartbeat");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });

  it("reports failures without throwing or logging the token", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    expect(await sendCaptureHeartbeat({ url: "https://standby.test", token: "secret", fetchImpl: fakeFetch(500).fetchImpl })).toBe("failed");
    expect(await sendCaptureHeartbeat({ url: "https://standby.test", token: "secret", fetchImpl: fakeFetch(new TypeError("fetch failed")).fetchImpl })).toBe("failed");
    expect(warn).toHaveBeenCalledWith("capture_heartbeat_failed", expect.objectContaining({ source: "capture_standby" }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });

  it("joins endpoints without doubling slashes", () => {
    expect(standbyEndpoint("https://standby.test/", "/status")).toBe("https://standby.test/status");
    expect(standbyEndpoint("https://standby.test", "/status")).toBe("https://standby.test/status");
  });
});
