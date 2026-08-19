import { pool } from "../src/lib/db/client";
import { COMBAT_PARSER_VERSION, parseCombatLine } from "../src/lib/combat/parser";

// Promotes previously-unparseable combat lines into combat_events after a
// parser upgrade. Safe to repeat; promoted rows leave combat_unparsed.
//
// Run on prod:
//   docker compose -f docker-compose.prod.yml --env-file=.env.production \
//     run --rm web npx tsx scripts/combat-reparse.ts

async function main(): Promise<void> {
  const rows = await pool.query<{ id: string; user_id: string; fingerprint: string; raw: string; occurred_at: Date | null; uploaded_at: Date }>(
    "SELECT id, user_id, fingerprint, raw, occurred_at, uploaded_at FROM combat_unparsed ORDER BY id",
  );
  let promoted = 0;
  for (const row of rows.rows) {
    const event = parseCombatLine(row.raw);
    if (!event) continue;
    if (event.kind !== "utility") {
      await pool.query(
        `INSERT INTO combat_events(user_id, fingerprint, character_name, kind, source, target, ability, amount, flag, raw, parser_version, occurred_at)
         VALUES($1, $2, '', $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT(user_id, fingerprint) DO NOTHING`,
        [row.user_id, row.fingerprint, event.kind, event.source, event.target, event.ability, event.amount, event.flag, row.raw, COMBAT_PARSER_VERSION, row.occurred_at ?? row.uploaded_at],
      );
    }
    await pool.query("DELETE FROM combat_unparsed WHERE id=$1", [row.id]);
    promoted += 1;
  }
  console.log(`Combat reparse ${COMBAT_PARSER_VERSION}: ${promoted} of ${rows.rowCount} unparsed lines promoted.`);
  await pool.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
