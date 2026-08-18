import { z } from "zod";
import { pool } from "@/lib/db/client";
import { authedUser } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";

// Cross-device store sync: last-write-wins per item on updated_at, with
// tombstones so deletions travel. GET returns items changed since a
// watermark; PUT upserts a batch, keeping whichever side is newer.

const STORES = ["loadouts", "components", "re_projects", "fc_loadouts"] as const;

const itemSchema = z.object({
  store: z.enum(STORES),
  itemId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
  updatedAt: z.string().datetime({ offset: true }),
  deleted: z.boolean().default(false),
});

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = await authedUser(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const sinceRaw = new URL(request.url).searchParams.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : new Date(0);
  const items = await pool.query(
    `SELECT store, item_id, payload, updated_at, deleted FROM sync_items
     WHERE user_id=$1 AND updated_at > $2 ORDER BY updated_at ASC LIMIT 2000`,
    [user.id, since],
  );
  return Response.json({
    serverTime: new Date().toISOString(),
    items: items.rows.map((row) => ({
      store: row.store,
      itemId: row.item_id,
      payload: row.payload,
      updatedAt: new Date(row.updated_at).toISOString(),
      deleted: row.deleted,
    })),
  });
}

export async function PUT(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = await authedUser(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = z.object({ items: z.array(itemSchema).max(2000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid sync batch", issues: parsed.error.issues }, { status: 400 });

  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query("BEGIN");
    for (const item of parsed.data.items) {
      const result = await client.query(
        `INSERT INTO sync_items(user_id, store, item_id, payload, updated_at, deleted)
         VALUES($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT(user_id, store, item_id) DO UPDATE
           SET payload=EXCLUDED.payload, updated_at=EXCLUDED.updated_at, deleted=EXCLUDED.deleted
           WHERE sync_items.updated_at < EXCLUDED.updated_at
         RETURNING item_id`,
        [user.id, item.store, item.itemId, JSON.stringify(item.payload), item.updatedAt, item.deleted],
      );
      applied += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return Response.json({ applied, serverTime: new Date().toISOString() });
}
