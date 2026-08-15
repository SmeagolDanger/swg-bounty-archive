import { describe, expect, it, vi } from "vitest";
import { AxiomTransport } from "./axiom";

describe("optional Axiom transport", () => {
  it("stays disabled when configuration is absent", () => {
    const factory = vi.fn();
    const reportFailure = vi.fn();
    const transport = new AxiomTransport({ token: "", dataset: "", clientFactory: factory, reportFailure });

    expect(transport.enabled).toBe(false);
    expect(transport.enqueue({ event: "test" })).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reports incomplete authentication without constructing a client", () => {
    const factory = vi.fn();
    const reportFailure = vi.fn();
    const transport = new AxiomTransport({ token: "token-only", dataset: "", clientFactory: factory, reportFailure });

    expect(transport.enabled).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith(expect.objectContaining({
      event: "axiom_configuration_incomplete",
      missing_fields: ["AXIOM_DATASET"],
    }));
  });

  it("queues structured events with the application timestamp field", () => {
    const ingest = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const transport = new AxiomTransport({
      token: "test-token",
      dataset: "outer-rim-ledger-production",
      clientFactory: () => ({ ingest, flush }),
    });
    const record = { timestamp: "2026-08-15T12:00:00.000Z", event: "ingestion_complete" };

    expect(transport.enqueue(record)).toBe(true);
    expect(ingest).toHaveBeenCalledWith("outer-rim-ledger-production", record, { timestampField: "timestamp" });
  });

  it("isolates synchronous and asynchronous Axiom failures", async () => {
    const reportFailure = vi.fn();
    let onError: ((error: Error) => void) | undefined;
    const transport = new AxiomTransport({
      token: "test-token",
      dataset: "outer-rim-ledger-production",
      reportFailure,
      clientFactory: (options) => {
        onError = options.onError;
        return {
          ingest: vi.fn(() => { throw new Error("Axiom offline"); }),
          flush: vi.fn().mockRejectedValue(new Error("flush offline")),
        };
      },
    });

    expect(transport.enqueue({ event: "ingestion_complete" })).toBe(false);
    onError?.(new Error("background authentication failed with Bearer abc123 token=private-token"));
    await expect(transport.flush()).resolves.toBe(false);
    expect(reportFailure).toHaveBeenCalledWith(expect.objectContaining({ event: "axiom_delivery_failed" }));
    expect(reportFailure).toHaveBeenCalledWith(expect.objectContaining({ event: "axiom_flush_failed" }));
    expect(JSON.stringify(reportFailure.mock.calls)).not.toContain("abc123");
    expect(JSON.stringify(reportFailure.mock.calls)).not.toContain("private-token");
  });
});
