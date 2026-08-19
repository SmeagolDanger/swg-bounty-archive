import { z } from "zod";
import { pool } from "@/lib/db/client";
import { userForApiToken, authedUser } from "@/lib/auth/session";
import { COMBAT_PARSER_VERSION, parseCombatLine } from "@/lib/combat/parser";
import { rateLimited } from "@/lib/rate-limit";

// Combat companion stream: small batches of raw chat-log lines, fingerprinted
// by the companion so restarts and retries never double-count. Parsed lines
// become live meter events; combat-looking lines the parser can't read are
// kept briefly in combat_unparsed for format diagnosis. Utility lines
// ("X performs Y") are recognized but not stored.
const uploadSchema = z.object({
  characterName: z.string().trim().max(80).default(""),
  events: z
    .array(
      z.object({
        raw: z.string().min(1).max(2_000),
        at: z.string().datetime({ offset: true }).optional(),
        fingerprint: z.string().min(8).max(128),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const user = (await userForApiToken(request)) ?? (await authedUser(request));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid upload", issues: parsed.error.issues }, { status: 400 });

  // Set-based insert: history imports push hundreds of batches, and
  // per-row round trips would crawl. One statement stores the whole batch.
  const columns = { fingerprint: [] as string[], kind: [] as string[], source: [] as string[], target: [] as string[], ability: [] as string[], amount: [] as number[], flag: [] as string[], raw: [] as string[], at: [] as Date[] };
  let duplicates = 0;
  let unparsed = 0;
  let ignored = 0;
  for (const item of parsed.data.events) {
    const event = parseCombatLine(item.raw);
    const occurredAt = item.at ? new Date(item.at) : new Date();
    if (!event) {
      const kept = await pool.query(
        `INSERT INTO combat_unparsed(user_id, fingerprint, raw, occurred_at)
         VALUES($1, $2, $3, $4) ON CONFLICT(user_id, fingerprint) DO NOTHING RETURNING id`,
        [user.id, item.fingerprint, item.raw, occurredAt],
      );
      if (kept.rowCount) unparsed += 1;
      else duplicates += 1;
      continue;
    }
    if (event.kind === "utility") {
      ignored += 1;
      continue;
    }
    columns.fingerprint.push(item.fingerprint);
    columns.kind.push(event.kind);
    columns.source.push(event.source);
    columns.target.push(event.target);
    columns.ability.push(event.ability);
    columns.amount.push(event.amount);
    columns.flag.push(event.flag);
    columns.raw.push(item.raw);
    columns.at.push(occurredAt);
  }
  let stored = 0;
  if (columns.fingerprint.length) {
    const inserted = await pool.query(
      `INSERT INTO combat_events(user_id, fingerprint, character_name, kind, source, target, ability, amount, flag, raw, parser_version, occurred_at)
       SELECT $1, u.fingerprint, $2, u.kind, u.source, u.target, u.ability, u.amount, u.flag, u.raw, $3, u.occurred_at
       FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::bigint[], $10::text[], $11::text[], $12::timestamptz[])
         AS u(fingerprint, kind, source, target, ability, amount, flag, raw, occurred_at)
       ON CONFLICT(user_id, fingerprint) DO NOTHING RETURNING id`,
      [
        user.id, parsed.data.characterName, COMBAT_PARSER_VERSION,
        columns.fingerprint, columns.kind, columns.source, columns.target, columns.ability,
        columns.amount, columns.flag, columns.raw, columns.at,
      ],
    );
    stored = inserted.rowCount ?? 0;
    duplicates += columns.fingerprint.length - stored;
  }
  return Response.json({ stored, duplicates, unparsed, ignored });
}
