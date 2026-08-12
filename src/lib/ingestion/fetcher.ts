export interface FetchResult {
  status: number;
  headers: Record<string, string>;
  payload: unknown | null;
  requestedAt: Date;
  receivedAt: Date;
  durationMs: number;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? Number(process.env.INGESTION_TIMEOUT_MS ?? 10_000);
  const maxRetries = options.maxRetries ?? Number(process.env.INGESTION_MAX_RETRIES ?? 3);
  const fetchImpl = options.fetchImpl ?? fetch;
  let finalError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const requestedAt = new Date();
    const started = performance.now();
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "SWG-Bounty-Archive/1.0 (+public-data-archiver)" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const receivedAt = new Date();
      const headers = Object.fromEntries(response.headers.entries());
      let payload: unknown | null = null;
      const text = await response.text();
      if (text) {
        try { payload = JSON.parse(text); }
        catch { payload = { unparsedBody: text.slice(0, 20_000) }; }
      }
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await delay(Number.isFinite(retryAfter) ? retryAfter * 1_000 : Math.min(1_000 * 2 ** attempt, 15_000));
        continue;
      }
      return { status: response.status, headers, payload, requestedAt, receivedAt, durationMs: Math.round(performance.now() - started) };
    } catch (error) {
      finalError = error;
      if (attempt < maxRetries) {
        await delay(Math.min(500 * 2 ** attempt, 8_000));
        continue;
      }
    }
  }
  throw finalError instanceof Error ? finalError : new Error("SWG request failed");
}
