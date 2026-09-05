import { createHash, randomBytes } from "node:crypto";

// Session credentials are 32 random bytes, base64url on the wire, sha256 at
// rest. The prefix makes a leaked string identifiable without being guessable.

const SESSION_PREFIX = "jts_";

export function mintToken(): { token: string; hash: string } {
  const token = SESSION_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeSessionToken(token: string): boolean {
  return token.startsWith(SESSION_PREFIX);
}
