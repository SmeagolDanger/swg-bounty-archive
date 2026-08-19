package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCharacterName(t *testing.T) {
	if got := characterName(`C:\SWGLegends\profiles\me\Omega\mail_Chickenrat`); got != "Chickenrat" {
		t.Fatalf("characterName = %q", got)
	}
	if got := characterName("/tmp/mail_Slimy_Salvadore"); got != "Slimy Salvadore" {
		t.Fatalf("characterName = %q", got)
	}
}

func TestContentHashNormalizesNewlines(t *testing.T) {
	if contentHash("a\r\nb") != contentHash("a\nb") {
		t.Fatal("CRLF and LF must hash identically")
	}
}

func TestCollectNewMailsSkipsUploadedAndNonMail(t *testing.T) {
	dir := t.TempDir()
	mailDir := filepath.Join(dir, "mail_Tester")
	if err := os.MkdirAll(mailDir, 0o755); err != nil {
		t.Fatal(err)
	}
	must := func(name, content string) {
		if err := os.WriteFile(filepath.Join(mailDir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	must("1.mail", "MAIL ONE")
	must("2.mail", "MAIL TWO")
	must("notes.txt", "not a mail")

	uploaded := map[string]bool{contentHash("MAIL ONE"): true}
	batch := collectNewMails([]string{mailDir}, uploaded, 100)
	if len(batch) != 1 || batch[0].Raw != "MAIL TWO" || batch[0].Character != "Tester" {
		t.Fatalf("unexpected batch: %+v", batch)
	}
}

func TestDiscoverAcceptsExplicitMailDir(t *testing.T) {
	dir := t.TempDir()
	mailDir := filepath.Join(dir, "mail_Someone")
	_ = os.MkdirAll(mailDir, 0o755)
	dirs := discoverMailDirs([]string{mailDir})
	if len(dirs) != 1 || dirs[0] != mailDir {
		t.Fatalf("discover = %v", dirs)
	}
	root := filepath.Join(dir, "install")
	nested := filepath.Join(root, "profiles", "acct", "Omega", "mail_Other")
	_ = os.MkdirAll(nested, 0o755)
	dirs = discoverMailDirs([]string{root})
	if len(dirs) != 1 || dirs[0] != nested {
		t.Fatalf("discover nested = %v", dirs)
	}
}

func TestDiscoverAcceptsSWGAideStyleArchive(t *testing.T) {
	root := t.TempDir()
	char := filepath.Join(root, "Chickenrat")
	_ = os.MkdirAll(char, 0o755)
	_ = os.WriteFile(filepath.Join(char, "1.mail"), []byte("x"), 0o644)
	dirs := discoverMailDirs([]string{root})
	if len(dirs) != 1 || dirs[0] != char {
		t.Fatalf("discover swgaide = %v", dirs)
	}
	if got := characterName(char); got != "Chickenrat" {
		t.Fatalf("characterName = %q", got)
	}
}

func TestCombatSuspect(t *testing.T) {
	yes := []string{
		"[Combat] 21:14:03 Beefy attacks a krayt with Sniper Shot and crits for 8342 points",
		"12:00:01 A womp rat attacks Beefy and hits for 210 points",
		"[Combat] 11:12:00 A womp rat is no more.",
	}
	no := []string{
		"Beefy attacks a womp rat for 100 points", // no timestamp
		"[Combat] 11:11:11 Beefy says hello there",
		"21:14:03 Beefy tells you good hunting",
	}
	for _, line := range yes {
		if !combatSuspect(line) {
			t.Errorf("expected combat suspect: %q", line)
		}
	}
	for _, line := range no {
		if combatSuspect(line) {
			t.Errorf("expected non-combat: %q", line)
		}
	}
}

func TestLineTimestampMidnightWrap(t *testing.T) {
	now := time.Date(2026, 8, 18, 0, 0, 30, 0, time.UTC)
	at := lineTimestamp("[Combat] 23:59:58 Beefy attacks a rat and hits for 5 points", now)
	parsed, err := time.Parse(time.RFC3339, at)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Day() != 17 {
		t.Errorf("expected previous day for pre-midnight stamp, got %v", parsed)
	}
}

func TestTailFileResume(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chatlog.txt")
	if err := os.WriteFile(path, []byte("line one\r\nline two\r\npartial"), 0o600); err != nil {
		t.Fatal(err)
	}
	offset, lines := tailFile(path, 0)
	if len(lines) != 2 || lines[0] != "line one" || lines[1] != "line two" {
		t.Fatalf("unexpected lines: %v", lines)
	}
	// Partial line stays unread until the newline lands.
	if _, more := tailFile(path, offset); more != nil {
		t.Fatalf("expected no complete lines, got %v", more)
	}
	file, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	file.WriteString(" done\n")
	file.Close()
	offset, lines = tailFile(path, offset)
	if len(lines) != 1 || lines[0] != "partial done" {
		t.Fatalf("unexpected completion: %v", lines)
	}
	// Truncation (rotation) resets to the top.
	if err := os.WriteFile(path, []byte("fresh\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, lines = tailFile(path, offset); len(lines) != 1 || lines[0] != "fresh" {
		t.Fatalf("expected rotation restart, got %v", lines)
	}
}

func TestDiscoverChatLogsByContent(t *testing.T) {
	root := t.TempDir()
	galaxy := filepath.Join(root, "profiles", "stormymichael", "Omega")
	if err := os.MkdirAll(galaxy, 0o755); err != nil {
		t.Fatal(err)
	}
	combat := "[Combat] 21:14:03 Beefy attacks a womp rat and hits for 210 points\r\n"
	// Oddly-named chat log with combat content: must be found.
	os.WriteFile(filepath.Join(galaxy, "SWGChat_2026.TXT"), []byte(combat), 0o600)
	// Plain notes file without combat lines: must be ignored.
	os.WriteFile(filepath.Join(galaxy, "notes.txt"), []byte("shopping list\nmore notes\n"), 0o600)
	// Non-txt file with combat content: ignored unless explicitly configured.
	os.WriteFile(filepath.Join(galaxy, "combat.log"), []byte(combat), 0o600)

	found := discoverChatLogs(nil, []string{root})
	if len(found) != 1 || filepath.Base(found[0]) != "SWGChat_2026.TXT" {
		t.Fatalf("expected only the combat-content txt, got %v", found)
	}

	// Pointing straight at the galaxy folder works too.
	found = discoverChatLogs([]string{galaxy}, nil)
	if len(found) != 1 {
		t.Fatalf("expected discovery from configured galaxy dir, got %v", found)
	}

	// Explicitly configured files are trusted regardless of name or content.
	found = discoverChatLogs([]string{filepath.Join(galaxy, "combat.log")}, []string{})
	if len(found) != 1 || filepath.Base(found[0]) != "combat.log" {
		t.Fatalf("expected explicit file to be accepted, got %v", found)
	}
}

func TestDiscoverOmegaCharacterChatLogs(t *testing.T) {
	// Real naming from production: <characterid>_chatlog.txt, and the tail
	// may be pure conversation with no combat lines in it.
	galaxy := filepath.Join(t.TempDir(), "profiles", "stormymichael", "Omega")
	if err := os.MkdirAll(galaxy, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(galaxy, "770814532499_chatlog.txt"), []byte("21:02:11 Beefy tells you hello there\r\n"), 0o600)
	os.WriteFile(filepath.Join(galaxy, "770814532499_expertise_builds.txt"), []byte("build notes\n"), 0o600)

	found := discoverChatLogs([]string{galaxy}, nil)
	if len(found) != 1 || filepath.Base(found[0]) != "770814532499_chatlog.txt" {
		t.Fatalf("expected the character chatlog by name, got %v", found)
	}
}

func TestParseLoginMarker(t *testing.T) {
	stamp, ok := parseLoginMarker("Logging In [Wed Feb 07 20:46:41 2024] ")
	if !ok || stamp.Year() != 2024 || stamp.Month() != time.February || stamp.Day() != 7 || stamp.Hour() != 20 {
		t.Fatalf("marker not parsed: %v %v", stamp, ok)
	}
	if _, ok := parseLoginMarker("[Combat]  18:34:38 RalphieJames attacks"); ok {
		t.Error("combat line must not parse as login marker")
	}
	// BOM-prefixed first line of a real log.
	if _, ok := parseLoginMarker("\uFEFFLogging In [Wed Feb 07 20:46:41 2024] "); !ok {
		t.Error("BOM-prefixed marker must parse")
	}
}

func TestImportDatingAnchors(t *testing.T) {
	// Marker mid-file: combat BEFORE it must backfill to earlier days,
	// combat after follows it, and a midnight wrap advances the day.
	dir := t.TempDir()
	path := filepath.Join(dir, "999_chatlog.txt")
	content := "\uFEFF[Chat]  22:39:54 Chat logging ON\r\n" +
		"[Combat]  23:50:00 Beefy attacks a womp rat and hits for 10 points\r\n" +
		"[Combat]  00:10:00 Beefy attacks a womp rat and hits for 11 points\r\n" + // wrapped: day -1 relative to marker
		"Logging In [Wed Feb 07 20:46:41 2024] \r\n" +
		"[Combat]  21:00:00 Beefy attacks a womp rat and hits for 12 points\r\n" +
		"[Combat]  01:00:00 Beefy attacks a womp rat and hits for 13 points\r\n" // wrapped past marker's midnight
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	var got []ChatEvent
	captureUpload = func(events []ChatEvent) { got = append(got, events...) }
	defer func() { captureUpload = nil }()
	end, done := importHistory(Config{Server: "test://capture"}, path, statusLogger{})
	if !done || end == 0 {
		t.Fatalf("import did not complete: %v %v", end, done)
	}
	if len(got) != 4 {
		t.Fatalf("expected 4 events, got %d", len(got))
	}
	day := func(at string) string { ts, _ := time.Parse(time.RFC3339, at); return ts.Format("2006-01-02 15:04") }
	if day(got[0].At) != "2024-02-06 23:50" || day(got[1].At) != "2024-02-07 00:10" {
		t.Errorf("pre-marker backfill wrong: %s %s", got[0].At, got[1].At)
	}
	if day(got[2].At) != "2024-02-07 21:00" || day(got[3].At) != "2024-02-08 01:00" {
		t.Errorf("post-marker dating wrong: %s %s", got[2].At, got[3].At)
	}
}

func TestImportDatingFromMtimeWithoutMarkers(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "998_chatlog.txt")
	content := "[Combat]  10:00:00 Beefy attacks a womp rat and hits for 10 points\r\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 8, 15, 22, 0, 0, 0, time.Local)
	os.Chtimes(path, stamp, stamp)

	var got []ChatEvent
	captureUpload = func(events []ChatEvent) { got = append(got, events...) }
	defer func() { captureUpload = nil }()
	if _, done := importHistory(Config{Server: "test://capture"}, path, statusLogger{}); !done {
		t.Fatal("import failed")
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 event, got %d", len(got))
	}
	ts, _ := time.Parse(time.RFC3339, got[0].At)
	if ts.Format("2006-01-02 15:04") != "2026-08-15 10:00" {
		t.Errorf("mtime anchoring wrong: %s", got[0].At)
	}
}
