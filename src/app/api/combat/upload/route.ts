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

  let stored = 0;
  let duplicates = 0;
  let unparsed = 0;
  let ignored = 0;
  for (const item of parsed.data.events) {
    const event = parseCombatLine(item.raw);
    const occurredAt = item.at ? new Date(item.at) : new Date();
    if (!event) {
      const kept = await pool.query(
        `INSERT INTO combat_unparsed(user_id, fingerprint, raw)
         VALUES($1, $2, $3) ON CONFLICT(user_id, fingerprint) DO NOTHING RETURNING id`,
        [user.id, item.fingerprint, item.raw],
      );
      if (kept.rowCount) unparsed += 1;
      else duplicates += 1;
      continue;
    }
    if (event.kind === "utility") {
      ignored += 1;
      continue;
    }
    const inserted = await pool.query(
      `INSERT INTO combat_events(user_id, fingerprint, character_name, kind, source, target, ability, amount, flag, raw, parser_version, occurred_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT(user_id, fingerprint) DO NOTHING RETURNING id`,
      [
        user.id,
        item.fingerprint,
        parsed.data.characterName,
        event.kind,
        event.source,
        event.target,
        event.ability,
        event.amount,
        event.flag,
        item.raw,
        COMBAT_PARSER_VERSION,
        occurredAt,
      ],
    );
    if (inserted.rowCount) stored += 1;
    else duplicates += 1;
  }
  return Response.json({ stored, duplicates, unparsed, ignored });
}
