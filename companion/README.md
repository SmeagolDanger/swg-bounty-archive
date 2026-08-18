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
3. Run it once — it writes `%APPDATA%\JawaTracks\config.json` and exits.
4. Paste your token into the config's `"token"` field and start it again.
   It sits in the tray and uploads new mail automatically.
5. In game, run `/mailsave` now and then (SWG writes your mail to
   `profiles\<account>\<galaxy>\mail_<character>\`). The companion finds the
   usual install paths; add yours to `"mailDirs"` if it's somewhere unusual.

## Importing your SWGAide history

SWGAide archives mails into its own folder (usually `SWGAide\mails\<Character>\`).
Add that folder to `"mailDirs"` and the companion imports the entire history
on first run — timestamps come from each mail, so historical sales land on
their real dates. Everything is deduplicated by content, so overlapping
game and SWGAide folders never double-count.

Sales appear in the Jawa Tracks app under **Tools → Sales Tracker** within a
minute of upload.

## Notes

- The token can be revoked at any time from the account page.
- Every mail is archived verbatim server-side; sale parsing is versioned and
  re-runnable, so nothing is lost if a mail format ever changes.
- Development: `go test ./...`; non-Windows builds run as a console app.

## Live DPS stream

The companion also tails your SWG chat log and streams combat lines to the
backend, powering the app's Combat Monitor screen in near real time.

- Turn on chat logging in game with `/chatLog` — the game then writes combat
  spam ("X attacks Y ... for N points") to a `chatlog*.txt` file under your
  profile folder. The line format matches BeefySan/SWGLogAnalyzer, so the
  same logs work in both tools.
- Discovery is automatic under your install/profiles folders; add explicit
  files or folders to `chatLogDirs` in config.json if yours live elsewhere.
- `chatPollSeconds` (default 2) controls the tail rate; set `disableDps`
  to `true` to turn the stream off entirely.
- Only combat-shaped lines are uploaded (never chat), each fingerprinted so
  restarts and retries can't double-count. The server keeps combat events
  for 14 days — it's a live meter, not an archive.
- On first sight of a log file the companion skips the existing backlog and
  streams only new lines, so old sessions never pollute the live view.
