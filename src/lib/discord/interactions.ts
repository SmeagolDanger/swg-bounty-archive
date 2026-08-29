import { createPublicKey, verify } from "node:crypto";

// Discord Interactions transport: request signature verification and the
// wire constants the slash-command handler needs. Discord signs every
// interaction with the application's Ed25519 key; Node verifies it natively,
// so no Discord SDK is required.

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
} as const;

export const EPHEMERAL = 1 << 6;

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
  options?: InteractionOption[];
}

export interface Interaction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  data?: { id?: string; name?: string; options?: InteractionOption[] };
  guild_id?: string;
  member?: { user?: { id: string; username?: string } };
  user?: { id: string; username?: string };
}

export interface Embed {
  author?: { name: string; url?: string; icon_url?: string };
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

export interface MessageBody {
  content?: string;
  embeds?: Embed[];
  flags?: number;
}

export interface InteractionResponse {
  type: number;
  data?: MessageBody | { choices: Array<{ name: string; value: string }> };
}

// Discord publishes the raw 32-byte Ed25519 key as hex. Node wants SPKI DER,
// which for Ed25519 is a fixed 12-byte prefix followed by the raw key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDiscordSignature(input: {
  publicKeyHex: string;
  signatureHex: string | null;
  timestamp: string | null;
  body: string;
}): boolean {
  if (!input.signatureHex || !input.timestamp) return false;
  if (!/^[0-9a-f]{64}$/i.test(input.publicKeyHex) || !/^[0-9a-f]{128}$/i.test(input.signatureHex)) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(input.publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(input.timestamp + input.body, "utf8"), key, Buffer.from(input.signatureHex, "hex"));
  } catch {
    return false;
  }
}

const DISCORD_API = "https://discord.com/api/v10";

// Replaces the "thinking…" placeholder of a deferred interaction. The
// interaction token authorizes this for 15 minutes; no bot token is needed.
export async function editOriginalResponse(applicationId: string, token: string, body: MessageBody, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${DISCORD_API}/webhooks/${applicationId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Discord follow-up returned HTTP ${response.status}`);
}
