import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/client";
import { createSession } from "./session";
import { PUT as syncPut, GET as syncGet } from "@/app/api/sync/route";
import { POST as tokenPost } from "@/app/api/account/tokens/route";
import { POST as mailPost } from "@/app/api/mail/upload/route";
import { GET as salesGet } from "@/app/api/sales/summary/route";
import { GET as recentGet } from "@/app/api/sales/recent/route";

const dbEnabled = process.env.RUN_DB_TESTS === "1";
const suite = dbEnabled ? describe : describe.skip;

const vendorMail = (id: number) => `${184000 + id}
FROM: SWG.Omega.auctioner
SUBJECT: Vendor Sale Complete
TIMESTAMP: ${1755468000 + id}

Vendor: Hangar Nine has sold [Mark V Reactor] to Wrollo for 250,000 credits.`;

suite("accounts, sync, and mail pipeline", () => {
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

  it("archives uploaded mail once and derives sales", async () => {
    const created = await tokenPost(bearer(sessionToken, { method: "POST", body: JSON.stringify({ name: "Test PC" }) }));
    const apiToken = (await created.json()).token as string;
    expect(apiToken.startsWith("jtk_")).toBe(true);

    const upload = await mailPost(bearer(apiToken, {
      method: "POST",
      body: JSON.stringify({ characterName: "ChickenRat", mails: [vendorMail(1), vendorMail(2)] }),
    }));
    expect(await upload.json()).toMatchObject({ archived: 2, duplicates: 0, sales: 2 });

    const again = await mailPost(bearer(apiToken, {
      method: "POST",
      body: JSON.stringify({ characterName: "ChickenRat", mails: [vendorMail(1)] }),
    }));
    expect(await again.json()).toMatchObject({ archived: 0, duplicates: 1, sales: 0 });

    const summary = await salesGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/sales/summary"));
    const body = await summary.json();
    expect(body.summary.total_sales).toBe(2);
    expect(body.summary.total_credits).toBe(500_000);
    expect(body.characters).toEqual(["ChickenRat"]);

    // Every numeric field must serialize as a JSON number — pg returns
    // uncast bigints as strings, which the app rejects as invalid.
    const recent = await recentGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/sales/recent"));
    const rows = (await recent.json()).sales;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(typeof row.credits).toBe("number");
    for (const value of Object.values(body.summary)) expect(typeof value).toBe("number");
  });
});
