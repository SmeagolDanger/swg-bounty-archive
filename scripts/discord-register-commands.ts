import { COMMAND_DEFINITIONS } from "../src/lib/discord/commands";

// Registers (bulk-overwrites) the bot's slash commands with Discord. Run once
// after deploying, and again whenever COMMAND_DEFINITIONS changes.
//
//   npm run discord:register                # global (propagates within ~1h)
//   npm run discord:register -- --guild ID  # one server, instant (good for testing)
//
// Requires DISCORD_CLIENT_ID (the application id) and DISCORD_BOT_TOKEN.

const applicationId = process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
if (!applicationId || !botToken) throw new Error("Set DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN");

const args = process.argv.slice(2);
const guildIndex = args.indexOf("--guild");
const guildId = guildIndex >= 0 ? args[guildIndex + 1] : undefined;
if (guildIndex >= 0 && !guildId) throw new Error("--guild needs a server id");

const url = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
  body: JSON.stringify(COMMAND_DEFINITIONS),
});
if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}: ${await response.text()}`);
const registered = await response.json() as Array<{ name: string }>;
process.stdout.write(`Registered ${registered.map((c) => `/${c.name}`).join(", ")} ${guildId ? `for guild ${guildId}` : "globally"}\n`);
