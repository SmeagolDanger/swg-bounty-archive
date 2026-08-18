import { z } from "zod";
import { pool } from "@/lib/db/client";
import { userForApiToken, authedUser } from "@/lib/auth/session";
import { MAIL_PARSER_VERSION, parseMail, parseSale } from "@/lib/mail/parser";

// Mail companion upload: a batch of raw /mailsave files. Every mail is
// archived verbatim and deduplicated by content fingerprint; sales are
// derived rows and always rebuildable from the raw archive.
const uploadSchema = z.object({
  characterName: z.string().trim().max(80).default(""),
  mails: z.array(z.string().min(1).max(64_000)).min(1).max(500),
});

export async function POST(request: Request) {
  const user = (await userForApiToken(request)) ?? (await authedUser(request));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid upload", issues: parsed.error.issues }, { status: 400 });

  let archived = 0;
  let duplicates = 0;
  let sales = 0;
  for (const raw of parsed.data.mails) {
    const mail = parseMail(raw);
    const inserted = await pool.query(
      `INSERT INTO mail_messages(user_id, fingerprint, character_name, sender, subject, sent_at, body, raw, parser_version)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(user_id, fingerprint) DO NOTHING
       RETURNING id`,
      [user.id, mail.fingerprint, parsed.data.characterName, mail.sender, mail.subject, mail.sentAt, mail.body, raw, MAIL_PARSER_VERSION],
    );
    const mailRowId = inserted.rows[0]?.id;
    if (!mailRowId) {
      duplicates += 1;
      continue;
    }
    archived += 1;
    const sale = parseSale(mail);
    if (sale) {
      await pool.query(
        `INSERT INTO mail_sales(user_id, mail_id, character_name, item_name, buyer, credits, vendor, sale_type, occurred_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT(mail_id) DO NOTHING`,
        [user.id, mailRowId, parsed.data.characterName, sale.itemName, sale.buyer, sale.credits, sale.vendor, sale.saleType, mail.sentAt ?? new Date()],
      );
      sales += 1;
    }
  }
  return Response.json({ archived, duplicates, sales });
}
