package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// Mail discovery. SWG writes /mailsave output to
//   <install>/profiles/<station>/<Galaxy>/mail_<Character>/<id>.mail
// We accept explicit mailDirs (install roots OR mail_ folders) and also
// probe the usual install locations on Windows.

var defaultRoots = []string{
	`C:\SWGLegends`,
	`C:\SWG Legends`,
	`C:\Program Files (x86)\SWGLegends`,
	`C:\Program Files\SWGLegends`,
	`C:\Games\SWGLegends`,
}

type MailFile struct {
	Path      string
	Character string
	Raw       string
	Hash      string
}

func discoverMailDirs(configured []string) []string {
	roots := configured
	if len(roots) == 0 {
		roots = defaultRoots
	}
	var dirs []string
	for _, root := range roots {
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			continue
		}
		if strings.HasPrefix(filepath.Base(root), "mail_") {
			dirs = append(dirs, root)
			continue
		}
		matches, _ := filepath.Glob(filepath.Join(root, "profiles", "*", "*", "mail_*"))
		dirs = append(dirs, matches...)
	}
	return dirs
}

func characterName(mailDir string) string {
	base := mailDir
	if i := strings.LastIndexAny(base, `/\`); i >= 0 {
		base = base[i+1:]
	}
	name := strings.TrimPrefix(base, "mail_")
	return strings.ReplaceAll(name, "_", " ")
}

func collectNewMails(dirs []string, uploaded map[string]bool, limit int) []MailFile {
	var batch []MailFile
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		character := characterName(dir)
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".mail") {
				continue
			}
			path := filepath.Join(dir, entry.Name())
			data, err := os.ReadFile(path)
			if err != nil || len(data) == 0 || len(data) > 64_000 {
				continue
			}
			raw := string(data)
			hash := contentHash(raw)
			if uploaded[hash] {
				continue
			}
			batch = append(batch, MailFile{Path: path, Character: character, Raw: raw, Hash: hash})
			if len(batch) >= limit {
				return batch
			}
		}
	}
	return batch
}

// Matches the server's fingerprint normalization (CRLF → LF before sha256).
func contentHash(raw string) string {
	sum := sha256.Sum256([]byte(strings.ReplaceAll(raw, "\r\n", "\n")))
	return hex.EncodeToString(sum[:])
}
