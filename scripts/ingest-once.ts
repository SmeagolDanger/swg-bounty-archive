import { pool } from "../src/lib/db/client";
import { runIngestion } from "../src/lib/ingestion/pipeline";
import { flushAxiom } from "../src/lib/observability/axiom";

try {
  const result = await runIngestion("ONCE");
  process.stdout.write(`Ingestion ${result.status.toLowerCase()}: ${result.runId}\n`);
} finally {
  await flushAxiom();
  await pool.end();
}
