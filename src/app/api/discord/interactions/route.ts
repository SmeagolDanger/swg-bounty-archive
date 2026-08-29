import { after } from "next/server";
import { handleInteraction } from "@/lib/discord/commands";
import { editOriginalResponse, type Interaction, verifyDiscordSignature } from "@/lib/discord/interactions";
import { getEncounters, getParticipant, searchEntities } from "@/lib/data";
import { errorLogContext, log } from "@/lib/observability/logger";

// Discord slash-command endpoint (Interactions Endpoint URL in the Discord
// developer portal). Every request is Ed25519-signed by Discord, which is the
// authentication; the public-API IP rate limiter is deliberately not applied
// because all traffic arrives from Discord's shared egress.
//
// Commands defer immediately and finish inside after(), so Discord's 3-second
// acknowledgement deadline never depends on query time.

const siteUrl = () => (process.env.PUBLIC_SITE_URL || process.env.AUTH_BASE_URL || "https://jawatracks.com").replace(/\/$/, "");

export async function POST(request: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return Response.json({ error: "Discord bot is not configured on this server" }, { status: 503 });

  const body = await request.text();
  const valid = verifyDiscordSignature({
    publicKeyHex: publicKey,
    signatureHex: request.headers.get("x-signature-ed25519"),
    timestamp: request.headers.get("x-signature-timestamp"),
    body,
  });
  if (!valid) {
    log.warn("discord_interaction_rejected", { source: "discord_bot", reason: "bad_signature" });
    return Response.json({ error: "Invalid request signature" }, { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(body) as Interaction;
  } catch {
    return Response.json({ error: "Malformed interaction" }, { status: 400 });
  }

  const handled = await handleInteraction(interaction, {
    siteUrl: siteUrl(),
    searchEntities,
    getEncounters,
    getParticipant: (id, type) => getParticipant(id, type),
  });

  if (handled.deferred) {
    const deferred = handled.deferred;
    after(async () => {
      const command = interaction.data?.name ?? "unknown";
      try {
        const message = await deferred();
        await editOriginalResponse(interaction.application_id, interaction.token, message);
        log.info("discord_interaction_answered", { source: "discord_bot", command, guild_id: interaction.guild_id ?? null });
      } catch (error) {
        log.warn("discord_interaction_failed", { source: "discord_bot", command, ...errorLogContext(error) });
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: "The archive could not answer that right now. Try again shortly.",
        }).catch(() => undefined);
      }
    });
  }
  return Response.json(handled.immediate);
}
