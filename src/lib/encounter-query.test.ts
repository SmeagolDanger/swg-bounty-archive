import { beforeEach, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ pool: { query } }));
import { getEncounters } from "./data";

beforeEach(() => query.mockReset());
it("report requests use exact hunter matching and skip all-time aggregation", async () => {
  query.mockResolvedValueOnce({ rows: [{ count: 1 }] }).mockResolvedValueOnce({ rows: [{ id: "e", hunter_name: "O'dae", credits: 1000 }] });
  const result = await getEncounters({ hunter: "O'dae", includeStats: false, from: "2026-09-01", to: "2026-09-12", tz: "UTC" });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][0]).toContain("lower(hunter_name)=lower($1)");
  expect(query.mock.calls[0][1]).toContain("O'dae");
  expect(query.mock.calls[0][0]).not.toContain("O'dae");
  expect(query.mock.calls[1][0]).toContain("WITH page_rows AS MATERIALIZED");
  expect(query.mock.calls[1][0]).toContain("ORDER BY event_at DESC,id DESC");
  expect(query.mock.calls[1][0]).toContain("FROM page_rows be");
  expect(result.rows[0].hunter_stats).toBeNull();
  expect(result.total).toBe(1);
});
it("existing feed callers still receive hunter statistics", async () => {
  query.mockResolvedValueOnce({ rows: [{ count: 1 }] }).mockResolvedValueOnce({ rows: [{ hunter_name: "Hunter" }] }).mockResolvedValueOnce({ rows: [{ hunter_key: "hunter", overall_kills: 10 }] });
  const result = await getEncounters({ q: "Hunt", page: 2, pageSize: 10 });
  expect(query).toHaveBeenCalledTimes(3);
  expect(query.mock.calls[0][1]).toEqual(["%Hunt%", "%Hunt%"]);
  expect(result.rows[0].hunter_stats?.overall_kills).toBe(10);
});
