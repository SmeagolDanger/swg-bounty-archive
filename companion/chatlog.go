package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Live DPS stream: tails SWG chat logs and ships combat lines to the backend
// every couple of seconds. The line grammar matches BeefySan/SWGLogAnalyzer
// ("[Combat] HH:MM:SS Actor attacks Target ... for N points"), and the
// server does the real parsing — the companion only prefilters, stamps each
// line with a full local timestamp (the log itself carries just HH:MM:SS),
// and fingerprints it so restarts and retries never double-count.

var combatStamp = regexp.MustCompile(`^(?:\[\s*Combat\s*\]\s*)?\d{2}:(\d{2}):(\d{2})\s`)
var combatClock = regexp.MustCompile(`(\d{2}):(\d{2}):(\d{2})`)

var combatWords = []string{"points", "attacks", "damages", "suffers", "heals", "is no more", "misses", "dodg", "parr", "performs", "caused"}

func combatSuspect(line string) bool {
	if !combatStamp.MatchString(line) {
		return false
	}
	lower := strings.ToLower(line)
	for _, word := range combatWords {
		if strings.Contains(lower, word) {
			return true
		}
	}
	return false
}

// The log stamps lines with local wall-clock time only; combine it with the
// local date, stepping back a day when the stamp would land in the future
// (a line written just before midnight, read just after).
func lineTimestamp(line string, now time.Time) string {
	match := combatClock.FindStringSubmatch(line)
	if match == nil {
		return now.Format(time.RFC3339)
	}
	var hh, mm, ss int
	fmt.Sscanf(match[0], "%d:%d:%d", &hh, &mm, &ss)
	stamped := time.Date(now.Year(), now.Month(), now.Day(), hh, mm, ss, 0, now.Location())
	if stamped.After(now.Add(5 * time.Minute)) {
		stamped = stamped.AddDate(0, 0, -1)
	}
	return stamped.Format(time.RFC3339)
}

// Chat log discovery: explicit chatLogDirs entries (files are taken as-is)
// plus likely folders under every configured root. Filenames are NOT
// trusted — SWG servers name chat logs differently and Windows users mix
// case — so any .txt whose tail contains combat-stamped lines qualifies.
func discoverChatLogs(configured []string, mailRoots []string) []string {
	seen := map[string]bool{}
	var files []string
	addFile := func(path string, sniff bool) {
		if path == "" || seen[path] {
			return
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			return
		}
		if sniff && !nameSuggestsChatLog(path) && !looksLikeCombatLog(path) {
			return
		}
		seen[path] = true
		files = append(files, path)
	}

	var dirs []string
	roots := append([]string{}, mailRoots...)
	if len(roots) == 0 {
		roots = defaultRoots
	}
	for _, entry := range configured {
		if info, err := os.Stat(entry); err == nil {
			if info.IsDir() {
				roots = append(roots, entry)
				continue
			}
			addFile(entry, false) // explicitly configured files always count
		}
	}
	for _, root := range roots {
		dirs = append(dirs, root,
			filepath.Join(root, "logs"),
			filepath.Join(root, "chatlogs"))
		profiles, _ := filepath.Glob(filepath.Join(root, "profiles", "*", "*"))
		for _, profile := range profiles {
			dirs = append(dirs, profile,
				filepath.Join(profile, "logs"),
				filepath.Join(profile, "chatlogs"))
		}
	}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".txt") {
				continue
			}
			addFile(filepath.Join(dir, entry.Name()), true)
		}
	}
	return files
}

// SWG servers name per-character logs like "770814532499_chatlog.txt";
// anything with "chatlog" in the name is taken on sight.
func nameSuggestsChatLog(path string) bool {
	name := strings.ToLower(filepath.Base(path))
	return strings.Contains(name, "chatlog") || strings.Contains(name, "chat_log")
}

// Reads the last few KB and looks for combat-stamped lines, so discovery
// keys on what a file contains instead of what it happens to be named.
func looksLikeCombatLog(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() == 0 {
		return false
	}
	const window = 8192
	offset := info.Size() - window
	if offset < 0 {
		offset = 0
	}
	if _, err := file.Seek(offset, 0); err != nil {
		return false
	}
	chunk := make([]byte, min64(window, info.Size()))
	read, _ := file.Read(chunk)
	for _, line := range strings.Split(string(chunk[:read]), "\n") {
		if combatStamp.MatchString(strings.TrimRight(line, "\r")) {
			return true
		}
	}
	return false
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

type ChatEvent struct {
	Raw         string `json:"raw"`
	At          string `json:"at"`
	Fingerprint string `json:"fingerprint"`
}

// Reads complete new lines from offset; a trailing partial line (no newline
// yet) is left for the next pass. A shrunken file means rotation: restart.
func tailFile(path string, offset int64) (int64, []string) {
	info, err := os.Stat(path)
	if err != nil {
		return offset, nil
	}
	if info.Size() < offset {
		offset = 0
	}
	if info.Size() == offset {
		return offset, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return offset, nil
	}
	defer file.Close()
	if _, err := file.Seek(offset, 0); err != nil {
		return offset, nil
	}
	chunk := make([]byte, info.Size()-offset)
	read, err := file.Read(chunk)
	if err != nil || read <= 0 {
		return offset, nil
	}
	chunk = chunk[:read]
	end := strings.LastIndexByte(string(chunk), '\n')
	if end < 0 {
		return offset, nil
	}
	consumed := chunk[:end+1]
	var lines []string
	for _, line := range strings.Split(string(consumed), "\n") {
		line = strings.TrimRight(line, "\r")
		if line != "" {
			lines = append(lines, line)
		}
	}
	return offset + int64(end+1), lines
}

func lineFingerprint(path string, offset int64, index int, line string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%s", path, offset, index, line)))
	return hex.EncodeToString(sum[:])
}

// Chat state is separate from mail state so the two loops never race on a
// shared file.
type ChatState struct {
	Offsets map[string]int64 `json:"offsets"`
}

func chatStatePath() string { return filepath.Join(configDir(), "chatstate.json") }

func loadChatState() ChatState {
	state := ChatState{Offsets: map[string]int64{}}
	if data, err := os.ReadFile(chatStatePath()); err == nil {
		_ = json.Unmarshal(data, &state)
	}
	if state.Offsets == nil {
		state.Offsets = map[string]int64{}
	}
	return state
}

func (s ChatState) save() {
	_ = os.MkdirAll(configDir(), 0o755)
	if data, err := json.MarshalIndent(s, "", " "); err == nil {
		_ = os.WriteFile(chatStatePath(), data, 0o600)
	}
}

func chatLoop(sink statusSink) {
	state := loadChatState()
	var files []string
	rescan := 0
	streamed := 0
	lastLine := map[string]string{} // consecutive-duplicate guard, per file

	for {
		config := conf()
		if !tokenConfigured(config) || config.DisableDps {
			time.Sleep(3 * time.Second)
			continue
		}
		if rescan == 0 {
			files = discoverChatLogs(config.ChatLogDirs, config.MailDirs)
		}
		rescan = (rescan + 1) % 15 // rediscover roughly every 30s

		for _, path := range files {
			offset := state.Offsets[path]
			// First sight of a file: skip its backlog — this is a live
			// monitor, and old sessions would arrive with wrong dates.
			if _, tracked := state.Offsets[path]; !tracked {
				if info, err := os.Stat(path); err == nil {
					state.Offsets[path] = info.Size()
					state.save()
				}
				continue
			}
			newOffset, lines := tailFile(path, offset)
			if len(lines) == 0 {
				if newOffset != offset {
					state.Offsets[path] = newOffset
					state.save()
				}
				continue
			}
			now := time.Now()
			var events []ChatEvent
			for index, line := range lines {
				// SWG sometimes writes the same combat line twice in a row;
				// drop exact consecutive repeats like SWGLogAnalyzer does.
				if line == lastLine[path] {
					continue
				}
				lastLine[path] = line
				if !combatSuspect(line) {
					continue
				}
				events = append(events, ChatEvent{
					Raw:         line,
					At:          lineTimestamp(line, now),
					Fingerprint: lineFingerprint(path, offset, index, line),
				})
			}
			if len(events) == 0 {
				state.Offsets[path] = newOffset
				state.save()
				continue
			}
			ok := true
			for start := 0; start < len(events); start += 500 {
				end := min(start+500, len(events))
				result, err := uploadCombat(config, events[start:end])
				if err != nil {
					sink.status(fmt.Sprintf("DPS upload failed: %v", err))
					ok = false
					break
				}
				streamed += result.Stored
			}
			if ok {
				state.Offsets[path] = newOffset
				state.save()
				sink.status(fmt.Sprintf("DPS: %d combat events streamed", streamed))
			}
		}
		time.Sleep(time.Duration(config.ChatPollSeconds) * time.Second)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
