import { handleParserReport } from "@/lib/parser-reports";
import { rateLimited } from "@/lib/rate-limit";

// The one write-shaped public endpoint: it forwards a redacted BattleTrace
// parser report to Discord and never touches the archive. A tight per-IP
// budget keeps a misbehaving client from flooding the channel.
export async function POST(request: Request) {
  const limited = rateLimited(request, { scope: "parser-reports", limit: 5 });
  if (limited) return limited;
  return handleParserReport(request);
}
