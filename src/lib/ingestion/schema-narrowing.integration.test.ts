import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "@/lib/db/client";
import { log } from "@/lib/observability/logger";
import { ingestFixture } from "./pipeline";

const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;

// Weekly rollover produces small boards whose nullable fields happen to have
// no null members — the type union narrows (null|string -> string) without
// the source changing. Narrowing must be archived silently; only widening
// (a type never observed on that path) may alarm.
suite("schema narrowing stays silent at weekly rollover", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const pid = (n: number) => `narrow-${suffix}-${n}`;
  let runId = "";

  const winsPayload = (entries: Array<Record<string, unknown>>) => ({
    id: "BOUNTY_HUNTER_TOTAL_KILLS", cityWins: entries, guildWins: entries, fetchedAt: "2026-08-15T22:00:00.000Z",
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (runId) {
      await pool.query("DELETE FROM data_quality_events WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
      await pool.query("DELETE FROM schema_signatures WHERE first_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
      await pool.query("DELETE FROM data_revisions WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
      await pool.query("DELETE FROM leaderboard_wins WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
      await pool.query("DELETE FROM participants WHERE source_participant_id LIKE $1", [`narrow-${suffix}-%`]);
      await pool.query("DELETE FROM api_ingestions WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM ingestion_runs WHERE id=$1", [runId]);
    }
    await pool.end();
  });

  it("does not alarm on narrowed or historically-known unions, still alarms on true widening", async () => {
    const run = await pool.query<{ id: string }>("INSERT INTO ingestion_runs(run_type) VALUES('ONCE') RETURNING id");
    runId = run.rows[0].id;

    // Baseline: guildAbbreviation and planet observed as null|string.
    await ingestFixture(runId, "leaderboard_wins", "wins", winsPayload([
      { rank: 1, participantId: pid(1), name: "Narrow A", wins: 1, guildAbbreviation: null, faction: "REBEL", planet: "corellia" },
      { rank: 2, participantId: pid(2), name: "Narrow B", wins: 1, guildAbbreviation: "ABC", faction: "REBEL", planet: null },
    ]), { case: `narrow-baseline-${suffix}` });

    const warning = vi.spyOn(log, "warn");

    // Narrowing only: every member carries the string variant (fresh board).
    await ingestFixture(runId, "leaderboard_wins", "wins", winsPayload([
      { rank: 3, participantId: pid(3), name: "Narrow C", wins: 2, guildAbbreviation: "DEF", faction: "REBEL", planet: "corellia" },
    ]), { case: `narrow-only-${suffix}` });
    expect(warning.mock.calls.filter(([event]) => event === "source_schema_changed")).toHaveLength(0);

    // Refill: planet returns to null|string — a NEW signature, but null was
    // observed on that path before the narrowed sample. Must stay silent.
    await ingestFixture(runId, "leaderboard_wins", "wins", winsPayload([
      { rank: 4, participantId: pid(4), name: "Narrow D", wins: 3, guildAbbreviation: "GHI", faction: "REBEL", planet: "corellia" },
      { rank: 5, participantId: pid(5), name: "Narrow E", wins: 3, guildAbbreviation: "JKL", faction: "REBEL", planet: null },
    ]), { case: `refill-${suffix}` });
    expect(warning.mock.calls.filter(([event]) => event === "source_schema_changed")).toHaveLength(0);

    // True widening: faction shows null, a type never observed on that path.
    await ingestFixture(runId, "leaderboard_wins", "wins", winsPayload([
      { rank: 6, participantId: pid(6), name: "Narrow F", wins: 4, guildAbbreviation: "MNO", faction: null, planet: "corellia" },
    ]), { case: `widen-${suffix}` });
    expect(warning.mock.calls.filter(([event]) => event === "source_schema_changed")).toHaveLength(1);

    const events = await pool.query(
      "SELECT id FROM data_quality_events WHERE event_type='SWG_API_SCHEMA_CHANGE' AND source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)",
      [runId],
    );
    expect(events.rowCount).toBe(1);
  });
});
