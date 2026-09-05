import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Bearer credentials are 32 random bytes, base64url on the wire, sha256 at
// rest. Prefixes make a leaked string identifiable without being guessable.

export type TokenKind = "session";

const PREFIX: Record<TokenKind, string> = { session: "jts_" };

export function mintToken(kind: TokenKind): { token: string; hash: string } {
  const token = PREFIX[kind] + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLike(kind: TokenKind, token: string): boolean {
  return token.startsWith(PREFIX[kind]);
}

/// Constant-time equality for hex digests.
export function digestsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
