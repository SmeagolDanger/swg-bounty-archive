# Jawa Tracks mail companion

A tiny Windows tray app that watches your SWG mail folders and uploads new
`/mailsave` files to jawatracks.com, powering the Sales Tracker in the Jawa
Tracks app. Uploads are content-hash deduplicated end to end — running it on
several PCs or re-uploading old folders never double-counts a sale.

## Setup

1. Sign in at **jawatracks.com/account** (Discord) and create a
   **mail companion token** — it is shown exactly once.
2. Download `JawaTracksCompanion.exe` (GitHub → Actions → latest
   "Build mail companion" run → artifact) onto your gaming PC.
3. Run it — on first start it opens **Settings** in your browser
   (also in the tray menu: right-click → *Open Settings*). Paste the token,
   hit **Test Connection**, then **Save**. Everything applies live; there is
   no config file to edit and no restart needed.
4. In game, run `/mailsave` now and then (SWG writes your mail to
   `profiles\<account>\<galaxy>\mail_<character>\`). The companion finds the
   usual install paths automatically — the Settings page shows exactly which
   mail folders and chat logs it discovered, and extra folders can be added
   there if yours live somewhere unusual.

## Importing your SWGAide history

SWGAide archives mails into its own folder (usually `SWGAide\mails\<Character>\`).
Add that folder under *Mail folders* in Settings and the companion imports the entire history
on first run — timestamps come from each mail, so historical sales land on
their real dates. Everything is deduplicated by content, so overlapping
game and SWGAide folders never double-count.

Sales appear in the Jawa Tracks app under **Tools → Sales Tracker** within a
minute of upload.

## Notes

- The token can be revoked at any time from the account page.
- Every mail is archived verbatim server-side; sale parsing is versioned and
  re-runnable, so nothing is lost if a mail format ever changes.
- Settings are served on `127.0.0.1` only (tray → Open Settings), guarded
  against cross-site writes; the token never leaves this PC except toward
  your configured server.
- `%APPDATA%\JawaTracks\config.json` still backs the settings if you ever
  want to script them.
- Development: `go test ./...`; non-Windows builds run as a console app with
  the same settings page.

## Live DPS stream

The companion also tails your SWG chat log and streams combat lines to the
backend, powering the app's Combat Monitor screen in near real time.

- Turn on chat logging in game with `/chatLog` — the game then writes combat
  spam ("X attacks Y ... for N points") to a `chatlog*.txt` file under your
  profile folder. The line format matches BeefySan/SWGLogAnalyzer, so the
  same logs work in both tools.
- Discovery is automatic under your install/profiles folders; add explicit
  files or folders under *Chat log folders* in Settings if yours live
  elsewhere.
- The *Combat poll* rate (default 2s) and the stream on/off toggle are in
  Settings and apply immediately.
- Only combat-shaped lines are uploaded (never chat), each fingerprinted so
  restarts and retries can't double-count. The server keeps combat events
  for 14 days — it's a live meter, not an archive.
- On first sight of a log file the companion skips the existing backlog and
  streams only new lines, so old sessions never pollute the live view.
