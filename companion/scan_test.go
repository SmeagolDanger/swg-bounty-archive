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
