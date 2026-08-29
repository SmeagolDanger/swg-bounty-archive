# Discord slash-command bot

Two slash commands bring the archive into Discord:

| Command | Output |
| --- | --- |
| `/feed [count] [hunter] [outcome] [min_credits]` | The bounty board as the website shows it: a `UTC · Hunter · COLLECTED/FAILED · Target · Payout` table of the latest contracts (default 10, max 15) under a one-line tally (collected, got away, credits paid out, date span). Filters mirror the `/encounters` page and the title links to the same filtered view. |
| `/hunter <name>` | A guild dossier for one character: faction rank and profession (from the Officers' Salute registry when enrolled), guild and home city, a K/D reputation grade, and a **Kill / Death record** card — kills, deaths, K/D, claim rate, credits — for the current cycle and all time, using the site's definition of deaths (failed contracts plus times killed while targeted). Highlights (biggest payday, unique marks, survival when hunted), this week's board ranks with podium medals, and a single nemesis. `name` autocompletes from the participant directory; hunters seen only in the encounter log get a K/D card from their encounter stats. |

## How it works

There is **no separate bot process**. Discord's *Interactions Endpoint* model
delivers each slash command as a signed HTTPS request, which the web container
serves at `POST /api/discord/interactions`:

1. The request is verified with the application's Ed25519 public key
   (`DISCORD_PUBLIC_KEY`) using Node's built-in `crypto`. Unsigned or tampered
   requests get `401` and never touch the database.
2. The handler acknowledges immediately with a deferred response, then finishes
   the query inside Next.js `after()` and edits the placeholder message. Discord's
   3-second deadline therefore never depends on query time.
3. Data comes from the same functions as the public JSON API (`getEncounters`,
   `getParticipant`, `searchEntities`); the bot is read-only and cannot change
   the archive.

Tabular content (encounter rows, rivalry records, the dossier stat card) is
rendered inside ```` ```ansi ```` code blocks with fixed-width columns and
colour escapes, because embeds cannot otherwise align proportional text.
Desktop clients show the colours (green claims, red failures, gold payouts);
mobile shows the same aligned text in plain grey. Ages are compact fixed-width
cells ("17m", "13h", "3d") computed at render time, so the message is a
snapshot — Discord's own "Today at …" stamp on the message records when.

Everything Discord-facing lives in `src/lib/discord/`: `interactions.ts`
(transport), `embeds.ts` (pure formatting, fully unit-tested), `commands.ts`
(definitions + dispatch, tested with injected data). Autocomplete answers
synchronously and only proposes `player` participants.

## Setup (one time)

Uses the same Discord application as [account sign-in](accounts.md).

1. In the [developer portal](https://discord.com/developers/applications), open the
   application → **General Information** and copy the **Public Key**.
2. Open **Bot**, click **Reset Token**, and copy the bot token. No privileged
   gateway intents are needed — the bot never connects to the gateway.
3. Add to `.env.production`:

   ```dotenv
   DISCORD_PUBLIC_KEY=...
   DISCORD_BOT_TOKEN=...
   ```

   and deploy (`scripts/deploy.sh`). The endpoint returns `503` until
   `DISCORD_PUBLIC_KEY` is set.
4. Back in **General Information**, set **Interactions Endpoint URL** to
   `https://jawatracks.com/api/discord/interactions` and save. Discord sends a
   signed `PING`; the save only succeeds if the endpoint answers it correctly.
5. Register the commands from the repo root (on the prod host or anywhere with
   the two variables exported):

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm web npm run discord:register
   ```

   Global commands can take up to an hour to appear; for instant results while
   testing, register to one server with `-- --guild <server id>`.
6. Invite the bot: **OAuth2 → URL Generator**, scope `applications.commands`
   (add `bot` with no permissions if you also want it listed as a member),
   open the generated URL, pick the server.

Re-run step 5 whenever `COMMAND_DEFINITIONS` in `src/lib/discord/commands.ts`
changes.

## Operations

- Structured events: `discord_interaction_answered`, `discord_interaction_failed`,
  `discord_interaction_rejected` (bad signature). They carry the command name
  and guild id only — never message content or tokens — and flow to Axiom when
  monitoring is enabled.
- The public-API per-IP rate limiter is intentionally not applied to this route:
  all traffic arrives from Discord's shared egress and is already authenticated
  by signature. Discord itself rate-limits users per command.
- If a query fails, the user sees "The archive could not answer that right now"
  and the failure is logged; nothing is retried.
- The bot shares the `web` container, so it scales, deploys, and restarts with
  the site. The weekly report webhook post (`DISCORD_REPORT_WEBHOOK_URL`) is a
  separate, worker-side feature and is unaffected.
