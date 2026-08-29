import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDiscordSignature } from "./interactions";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { privateKey, publicKeyHex: Buffer.from(jwk.x, "base64url").toString("hex") };
}

describe("Discord signature verification", () => {
  const { privateKey, publicKeyHex } = keypair();
  const body = JSON.stringify({ type: 1 });
  const timestamp = "1724900000";
  const signatureHex = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

  it("accepts a request signed with the application key", () => {
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp, body })).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp, body: body + " " })).toBe(false);
  });

  it("rejects a replayed signature with a different timestamp", () => {
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp: "1724900001", body })).toBe(false);
  });

  it("rejects another application's key", () => {
    expect(verifyDiscordSignature({ publicKeyHex: keypair().publicKeyHex, signatureHex, timestamp, body })).toBe(false);
  });

  it("rejects missing or malformed headers without throwing", () => {
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex: null, timestamp, body })).toBe(false);
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp: null, body })).toBe(false);
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex: "zz", timestamp, body })).toBe(false);
    expect(verifyDiscordSignature({ publicKeyHex: "nothex", signatureHex, timestamp, body })).toBe(false);
  });
});
