import { Axiom } from "@axiomhq/js";

type AxiomClient = Pick<Axiom, "ingest" | "flush">;
type AxiomClientOptions = ConstructorParameters<typeof Axiom>[0];

export interface AxiomTransportConfig {
  token?: string;
  dataset?: string;
  clientFactory?: (options: AxiomClientOptions) => AxiomClient;
  reportFailure?: (record: Record<string, unknown>) => void;
}

function safeError(error: unknown): { error_type: string; error_message: string } {
  const source = error instanceof Error ? error : new Error(String(error));
  return {
    error_type: source.name,
    error_message: source.message
      .replace(/\bpostgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
      .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTED]")
      .replace(/\b(token|password|secret|api[_-]?key)=([^\s&]+)/gi, "$1=[REDACTED]"),
  };
}

function defaultFailureReporter(record: Record<string, unknown>): void {
  try {
    process.stderr.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      service: "outer-rim-ledger",
      environment: process.env.AXIOM_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
      ...record,
    })}\n`);
  } catch {
    // Hosted observability is deliberately non-critical.
  }
}

export class AxiomTransport {
  private readonly dataset?: string;
  private readonly client?: AxiomClient;
  private readonly reportFailure: (record: Record<string, unknown>) => void;

  constructor(config: AxiomTransportConfig = {}) {
    const token = config.token?.trim();
    this.dataset = config.dataset?.trim();
    this.reportFailure = config.reportFailure ?? defaultFailureReporter;

    if (!token && !this.dataset) return;
    if (!token || !this.dataset) {
      this.reportFailure({
        event: "axiom_configuration_incomplete",
        status: "failed",
        missing_fields: [!token ? "AXIOM_TOKEN" : null, !this.dataset ? "AXIOM_DATASET" : null].filter(Boolean),
      });
      return;
    }

    const factory = config.clientFactory ?? ((options) => new Axiom(options));
    try {
      this.client = factory({
        token,
        onError: (error) => this.reportFailure({ event: "axiom_delivery_failed", status: "failed", ...safeError(error) }),
      });
    } catch (error) {
      this.reportFailure({ event: "axiom_initialization_failed", status: "failed", ...safeError(error) });
    }
  }

  get enabled(): boolean {
    return Boolean(this.client && this.dataset);
  }

  enqueue(record: Record<string, unknown>): boolean {
    if (!this.client || !this.dataset) return false;
    try {
      this.client.ingest(this.dataset, record, { timestampField: "timestamp" });
      return true;
    } catch (error) {
      this.reportFailure({ event: "axiom_delivery_failed", status: "failed", ...safeError(error) });
      return false;
    }
  }

  async flush(timeoutMs = 3_000): Promise<boolean> {
    if (!this.client) return false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.client.flush(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`Axiom flush exceeded ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return true;
    } catch (error) {
      this.reportFailure({ event: "axiom_flush_failed", status: "failed", ...safeError(error) });
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

const transport = new AxiomTransport({
  token: process.env.AXIOM_TOKEN,
  dataset: process.env.AXIOM_DATASET,
});

export const axiomConfigured = transport.enabled;
export const publishToAxiom = (record: Record<string, unknown>): boolean => transport.enqueue(record);
export const flushAxiom = (timeoutMs?: number): Promise<boolean> => transport.flush(timeoutMs);
