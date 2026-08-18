package main

import (
	"os"
	"path/filepath"
	"testing"
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
