const globalStore = globalThis as typeof globalThis & { __swgRateLimits?: Map<string, { count: number; reset: number }> };
const store = globalStore.__swgRateLimits ?? new Map<string, { count: number; reset: number }>();
globalStore.__swgRateLimits = store;

export function checkRateLimit(request: Request): { allowed: boolean; remaining: number; reset: number } {
  const limit = Math.max(10, Number(process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE ?? 120));
  // The rightmost x-forwarded-for entry is the one appended by the trusted reverse
  // proxy in front of this app; leftmost entries are client-supplied and spoofable.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
  const ip = forwarded?.at(-1) ?? request.headers.get("x-real-ip") ?? "local";
  const now = Date.now();
  const existing = store.get(ip);
  const bucket = !existing || existing.reset <= now ? { count: 0, reset: now + 60_000 } : existing;
  bucket.count += 1;
  store.set(ip, bucket);
  if (store.size > 10_000) for (const [key, value] of store) if (value.reset <= now) store.delete(key);
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), reset: bucket.reset };
}

export function rateLimited(request: Request): Response | null {
  const result = checkRateLimit(request);
  if (result.allowed) return null;
  return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)) } });
}
