# Jawa Tracks accounts

One Discord sign-in connects the Jawa Tracks app (iOS/macOS). The public
archive requires no account, and the bounty collection pipeline is completely
independent of this system.

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

## Data separation

Account tables (`users`, `sessions`, `sync_items`) are additive and cascade
per user. Nothing reads or writes the bounty/GCW archive tables. When the
companion features were removed, the contractually short-lived combat tables
and the credential table (`api_tokens`) were dropped by migration 0015; the
mail archive tables (`mail_messages`, `mail_sales`, `mail_purchases`) are
deliberately retained with their uploaded history, dormant, and can be
dropped by a future migration if that history is no longer wanted.
