import { pool } from "../src/lib/db/client";
import { MAIL_PARSER_VERSION, parseMail, parsePurchase, parseSale } from "../src/lib/mail/parser";

// Re-runs the mail parser over the raw archive: refreshes sender/subject/
// sent_at on every message and derives sales that earlier parser versions
// missed. Raw text is never modified — this is always safe to repeat.
//
// Run on prod:
//   docker compose -f docker-compose.prod.yml --env-file=.env.production \
//     run --rm web npx tsx scripts/mail-reparse.ts

async function main(): Promise<void> {
  const mails = await pool.query<{ id: string; user_id: string; character_name: string; raw: string }>(
    "SELECT id, user_id, character_name, raw FROM mail_messages ORDER BY uploaded_at",
  );
  let updated = 0;
  let newSales = 0;
  let newPurchases = 0;

  for (const row of mails.rows) {
    const mail = parseMail(row.raw);
    const changed = await pool.query(
      `UPDATE mail_messages
       SET sender=$2, subject=$3, sent_at=COALESCE($4, sent_at), parser_version=$5
       WHERE id=$1 AND (sender IS DISTINCT FROM $2 OR subject IS DISTINCT FROM $3 OR parser_version <> $5)
       RETURNING id`,
      [row.id, mail.sender, mail.subject, mail.sentAt, MAIL_PARSER_VERSION],
    );
    updated += changed.rowCount ?? 0;

    const sale = parseSale(mail);
    if (sale) {
      const inserted = await pool.query(
        `INSERT INTO mail_sales(user_id, mail_id, character_name, item_name, buyer, credits, vendor, sale_type, occurred_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT(mail_id) DO NOTHING RETURNING id`,
        [row.user_id, row.id, row.character_name, sale.itemName, sale.buyer, sale.credits, sale.vendor, sale.saleType, mail.sentAt ?? new Date()],
      );
      newSales += inserted.rowCount ?? 0;
    }
    const purchase = parsePurchase(mail);
    if (purchase) {
      const inserted = await pool.query(
        `INSERT INTO mail_purchases(user_id, mail_id, character_name, item_name, seller, credits, purchase_type, occurred_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT(mail_id) DO NOTHING RETURNING id`,
        [row.user_id, row.id, row.character_name, purchase.itemName, purchase.seller, purchase.credits, purchase.purchaseType, mail.sentAt ?? new Date()],
      );
      newPurchases += inserted.rowCount ?? 0;
    }
  }

  console.log(`Reparsed ${mails.rowCount} mails with parser ${MAIL_PARSER_VERSION}: ${updated} headers refreshed, ${newSales} new sales and ${newPurchases} new purchases derived.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
