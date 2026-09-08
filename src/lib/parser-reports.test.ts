import { describe, expect, it } from "vitest";
import { formatParserReport, handleParserReport, parserReportSchema, type ParserReport } from "./parser-reports";

const report: ParserReport = {
  app: "battletrace",
  version: "0.9.2",
  analysisVersion: "0.9.2/catalog-3/parser-2/index-3",
  combatLineCount: 13777,
  unsupportedLineCount: 3,
  shapes: [
    { shape: "<name> are caught in the blast of an exploding droid!  <name> take # damage!", count: 1 },
    { shape: "<name> is not online.", count: 2 },
  ],
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://jawatracks.com/api/parser-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("parser report schema", () => {
  it("accepts a well-formed report and rejects missing or oversized shape lists", () => {
    expect(parserReportSchema.safeParse(report).success).toBe(true);
    expect(parserReportSchema.safeParse({ ...report, shapes: [] }).success).toBe(false);
    expect(parserReportSchema.safeParse({ ...report, app: "other" }).success).toBe(false);
    const tooMany = Array.from({ length: 51 }, (_, index) => ({ shape: `s${index}`, count: 1 }));
    expect(parserReportSchema.safeParse({ ...report, shapes: tooMany }).success).toBe(false);
  });
});

describe("formatParserReport", () => {
  it("sorts by frequency, neutralizes code fences, and stays under Discord's limit", () => {
    const text = formatParserReport(
      { ...report, shapes: [...report.shapes, { shape: "weird ``` fence", count: 9 }] },
      new Date("2026-09-07T21:30:00Z"),
    );
    expect(text).toContain("**BattleTrace parser report** · v0.9.2 · 3 of 13,777 combat lines unrecognized · 2026-09-07 21:30 UTC");
    expect(text.indexOf("9× weird ''' fence")).toBeLessThan(text.indexOf("2× <name> is not online."));
    expect(text.indexOf("2× <name> is not online.")).toBeLessThan(text.indexOf("1× <name> are caught"));
    const long = { ...report, shapes: Array.from({ length: 50 }, (_, index) => ({ shape: `${"x".repeat(380)} ${index}`, count: 1 })) };
    const truncated = formatParserReport(long);
    expect(truncated.length).toBeLessThanOrEqual(2000);
    expect(truncated).toMatch(/…and \d+ more shapes\./);
  });
});

describe("handleParserReport", () => {
  it("is disabled without a webhook", async () => {
    const response = await handleParserReport(post(report), { webhook: "" });
    expect(response.status).toBe(503);
  });

  it("rejects non-JSON, invalid, and oversized bodies without calling Discord", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return new Response(null, { status: 204 }); }) as typeof fetch;
    expect((await handleParserReport(post("not json"), { webhook: "https://discord.test/hook", fetchImpl })).status).toBe(400);
    const invalid = await handleParserReport(post({ ...report, shapes: [] }), { webhook: "https://discord.test/hook", fetchImpl });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "Invalid report" });
    const huge = await handleParserReport(post(report, { "content-length": String(1_000_000) }), { webhook: "https://discord.test/hook", fetchImpl });
    expect(huge.status).toBe(413);
    expect(calls).toBe(0);
  });

  it("forwards a valid report to the webhook with mentions disabled", async () => {
    const captured: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), body: String(init?.body) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const response = await handleParserReport(post(report), { webhook: "https://discord.test/hook", fetchImpl, now: () => new Date("2026-09-07T21:30:00Z") });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, shapes: 2 });
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://discord.test/hook");
    const payload = JSON.parse(captured[0].body);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content).toContain("<name> is not online.");
  });

  it("reports delivery failures as 502", async () => {
    const fetchImpl = (async () => new Response(null, { status: 500 })) as typeof fetch;
    const response = await handleParserReport(post(report), { webhook: "https://discord.test/hook", fetchImpl });
    expect(response.status).toBe(502);
  });
});
