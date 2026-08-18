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

Sales appear in the Jawa Tracks app under **Tools → Sales Tracker** within a
minute of upload.

## Notes

- The token can be revoked at any time from the account page.
- Every mail is archived verbatim server-side; sale parsing is versioned and
  re-runnable, so nothing is lost if a mail format ever changes.
- Development: `go test ./...`; non-Windows builds run as a console app.
