import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/client";
import { createSession } from "./session";
import { PUT as syncPut, GET as syncGet } from "@/app/api/sync/route";

const dbEnabled = process.env.RUN_DB_TESTS === "1";
const suite = dbEnabled ? describe : describe.skip;

suite("accounts and sync", () => {
  let userId = "";
  let sessionToken = "";

  afterAll(async () => {
    if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool.end();
  });

  const bearer = (token: string, init: RequestInit = {}, url = "https://test.local/api") =>
    new Request(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });

  it("creates a user and app session", async () => {
    const user = await pool.query(
      "INSERT INTO users(discord_id, discord_username) VALUES($1, $2) RETURNING id",
      [`test-${randomUUID()}`, "Integration Tester"],
    );
    userId = user.rows[0].id;
    sessionToken = await createSession(userId, "app");
    expect(sessionToken.startsWith("jts_")).toBe(true);
  });

  it("syncs items with last-write-wins and tombstones", async () => {
    const itemId = randomUUID();
    const newer = new Date().toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();

    const first = await syncPut(bearer(sessionToken, {
      method: "PUT",
      body: JSON.stringify({ items: [{ store: "loadouts", itemId, payload: { name: "A-Wing Alpha" }, updatedAt: newer, deleted: false }] }),
    }));
    expect((await first.json()).applied).toBe(1);

    const stale = await syncPut(bearer(sessionToken, {
      method: "PUT",
      body: JSON.stringify({ items: [{ store: "loadouts", itemId, payload: { name: "Stale Edit" }, updatedAt: older, deleted: false }] }),
    }));
    expect((await stale.json()).applied).toBe(0);

    const state = await syncGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/sync?since=1970-01-01T00:00:00Z"));
    const items = (await state.json()).items;
    expect(items).toHaveLength(1);
    expect(items[0].payload.name).toBe("A-Wing Alpha");
  });
});
