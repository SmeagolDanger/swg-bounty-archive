import { pool } from "../src/lib/db/client";
import { runIngestion } from "../src/lib/ingestion/pipeline";

try {
  const runId = await runIngestion("ONCE");
  process.stdout.write(`Ingestion complete: ${runId}\n`);
} finally {
  await pool.end();
}
