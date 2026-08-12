import { describe, expect, it, vi } from "vitest";
import { fetchJson } from "./fetcher";

describe("API retry and timeout handling", () => {
  it("retries a transient response and parses JSON", async () => {
    const implementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await fetchJson("https://example.test", { fetchImpl: implementation, maxRetries: 1, timeoutMs: 100 });
    expect(implementation).toHaveBeenCalledTimes(2);
    expect(result.payload).toEqual({ ok: true });
  });

  it("surfaces a timeout after retries", async () => {
    const implementation = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(fetchJson("https://example.test", { fetchImpl: implementation, maxRetries: 1, timeoutMs: 1 })).rejects.toThrow(/timed out/);
    expect(implementation).toHaveBeenCalledTimes(2);
  });
});
