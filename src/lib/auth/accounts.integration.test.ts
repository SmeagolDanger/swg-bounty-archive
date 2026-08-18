import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/client";
import { createSession } from "./session";
import { PUT as syncPut, GET as syncGet } from "@/app/api/sync/route";
import { POST as tokenPost } from "@/app/api/account/tokens/route";
import { POST as mailPost } from "@/app/api/mail/upload/route";
import { GET as salesGet } from "@/app/api/sales/summary/route";
import { GET as recentGet } from "@/app/api/sales/recent/route";
import { GET as customersGet } from "@/app/api/sales/customers/route";
import { GET as purchasesGet } from "@/app/api/sales/purchases/route";
import { POST as combatPost } from "@/app/api/combat/upload/route";
import { GET as combatLiveGet } from "@/app/api/combat/live/route";
import { GET as combatSessionsGet } from "@/app/api/combat/sessions/route";

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

    const summary = await salesGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/sales/summary?tz=America/Halifax"));
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

    const byBuyer = await recentGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/sales/recent?buyer=Wrollo"));
    expect((await byBuyer.json()).sales).toHaveLength(2);
    const noMatch = await recentGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/sales/recent?buyer=Nobody"));
    expect((await noMatch.json()).sales).toHaveLength(0);

    const customers = await customersGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/sales/customers"));
    const ledger = (await customers.json()).customers;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ buyer: "Wrollo", purchases: 2 });
    expect(typeof ledger[0].credits).toBe("number");
  });

  it("streams combat lines into live meter events", async () => {
    const stamp = new Date().toISOString();
    const upload = await combatPost(bearer(sessionToken, {
      method: "POST",
      body: JSON.stringify({
        characterName: "ChickenRat",
        events: [
          { raw: "[Combat] 21:14:03 Beefy attacks a canyon krayt dragon with Rifle Sniper Shot and crits for 8342 points", at: stamp, fingerprint: "combat-test-1" },
          { raw: "[Combat] 21:14:04 Shepard heals Beefy for 3200 points with Bacta Ampule", at: stamp, fingerprint: "combat-test-2" },
          { raw: "[Combat] 21:14:05 Beefy performs Overcharge Shot.", at: stamp, fingerprint: "combat-test-3" },
          { raw: "[Combat] 21:14:06 some totally unknown combat shape happened for reasons", at: stamp, fingerprint: "combat-test-4" },
        ],
      }),
    }));
    expect(await upload.json()).toMatchObject({ stored: 2, unparsed: 1, ignored: 1, duplicates: 0 });

    const seed = await combatLiveGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/combat/live?after=0"));
    const body = await seed.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({ kind: "damage", source: "Beefy", flag: "crit" });
    for (const event of body.events) expect(typeof event.amount).toBe("number");
    expect(body.latest).toBeGreaterThan(0);

    const caughtUp = await combatLiveGet(bearer(sessionToken, { method: "GET" }, `https://test.local/api/combat/live?after=${body.latest}`));
    expect((await caughtUp.json()).events).toHaveLength(0);

    const again = await combatPost(bearer(sessionToken, {
      method: "POST",
      body: JSON.stringify({
        characterName: "ChickenRat",
        events: [{ raw: "[Combat] 21:14:03 Beefy attacks a canyon krayt dragon with Rifle Sniper Shot and crits for 8342 points", at: stamp, fingerprint: "combat-test-1" }],
      }),
    }));
    expect(await again.json()).toMatchObject({ stored: 0, duplicates: 1 });

    const history = await combatSessionsGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/combat/sessions?days=1"));
    const sessions = (await history.json()).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].encounters[0].title).toBe("A canyon krayt dragon");
    expect(sessions[0].encounters[0].actors[0]).toMatchObject({ name: "Beefy", damage: 8342, crits: 1 });
    expect(sessions[0].topPlayer).toBe("Beefy");
  });

  it("derives purchases from buyer-side mails", async () => {
    const purchaseMail = `190001
SWG.Omega.auctioner
Auction Won
TIMESTAMP: 1755480000

You have won the auction of Mark IV Engine from Torye Klyn for 98,500 credits`;
    const created = await tokenPost(bearer(sessionToken, { method: "POST", body: JSON.stringify({ name: "Test PC 2" }) }));
    const apiToken = (await created.json()).token as string;
    const upload = await mailPost(bearer(apiToken, {
      method: "POST",
      body: JSON.stringify({ characterName: "ChickenRat", mails: [purchaseMail] }),
    }));
    expect(await upload.json()).toMatchObject({ archived: 1, sales: 0, purchases: 1 });

    const purchases = await purchasesGet(bearer(sessionToken, { method: "GET" }, "https://test.local/api/sales/purchases"));
    const rows = (await purchases.json()).purchases;
    expect(rows).toHaveLength(1);
    expect(rows[0].item_name).toBe("Mark IV Engine");
    expect(typeof rows[0].credits).toBe("number");
  });
});
