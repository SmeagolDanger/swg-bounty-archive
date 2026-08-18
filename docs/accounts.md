# Jawa Tracks accounts

One Discord sign-in connects the Jawa Tracks app (iOS/macOS) and the mail
companion (Windows). The public archive requires no account, and the bounty
collection pipeline is completely independent of this system.

## Server setup (one time)

1. Create a Discord application at https://discord.com/developers/applications
   → **New Application** → name it "Jawa Tracks".
2. Under **OAuth2**, add the redirect:
   `https://jawatracks.com/api/auth/discord/callback`
3. Copy the **Client ID** and **Client Secret** into `.env.production`:

   ```dotenv
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   AUTH_BASE_URL=https://jawatracks.com
   ```

4. Deploy. Sign-in appears at `/account`; blank credentials keep it disabled.

## How sign-in works

- `/api/auth/discord/start?client=web|app` → Discord → `/api/auth/discord/callback`.
- Web sessions ride an httpOnly cookie; app sessions return via the
  `jawatracks://auth` deep link and live in the device keychain.
- Sessions last 180 days and slide on every use — active users are never
  asked to sign in again, and Discord re-approves silently (`prompt=none`).

## Store sync (app)

Signed-in devices sync saved loadouts, components, RE projects, and FC
builds through `/api/sync`: per-item last-write-wins on `updated_at`, with
tombstones so deletions propagate. Signed out, the app is fully standalone —
sync simply pauses.

## Mail companion & sales

1. On `/account`, create a **mail companion token** (shown once).
2. Run the companion on the gaming PC with that token; it watches the SWG
   `profiles/**/mail_*` folders and uploads new `.mail` files.
3. Every mail is archived verbatim (deduplicated by content hash); vendor
   and bazaar sale mails become rows in `mail_sales`. The parser is
   versioned — it can be corrected and re-run over the raw archive at any
   time without losing anything.
4. Sales stats appear in the app under Tools → Sales.

## Data separation

Account tables (`users`, `sessions`, `api_tokens`, `sync_items`,
`mail_messages`, `mail_sales`) are additive and cascade per user. Nothing
reads or writes the bounty/GCW archive tables, and prod-sync remains
unchanged.
