package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// One-time history import. SWG chat logs stamp lines with HH:MM:SS only.
// Dating works in two passes:
//
//  1. Every stamped line gets a day index that increments whenever the
//     clock jumps backwards (crossed midnight).
//  2. Absolute dates come from anchors: "Logging In [Wed Feb 07 20:46:41
//     2024]" markers where present — including BACKWARD from the first
//     marker, since files often open mid-session with combat before any
//     login — and, for files with no markers at all, the file's modified
//     time pinned to the last line.
//
// Runs once per file (tracked by offset state); server-side fingerprint
// dedup makes interrupted imports safe to redo.

var loginLayouts = []string{
	"Mon Jan 02 15:04:05 2006",
	"Mon Jan _2 15:04:05 2006",
}

func parseLoginMarker(line string) (time.Time, bool) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(line, "\uFEFF"))
	if !strings.HasPrefix(trimmed, "Logging In [") {
		return time.Time{}, false
	}
	open := strings.Index(trimmed, "[")
	close := strings.Index(trimmed, "]")
	if open < 0 || close <= open {
		return time.Time{}, false
	}
	stamp := strings.TrimSpace(trimmed[open+1 : close])
	for _, layout := range loginLayouts {
		if parsed, err := time.ParseInLocation(layout, stamp, time.Local); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func lineClockSeconds(line string) (int, bool) {
	match := combatClock.FindStringSubmatch(line)
	if match == nil {
		return 0, false
	}
	hh, _ := strconv.Atoi(match[1])
	mm, _ := strconv.Atoi(match[2])
	ss, _ := strconv.Atoi(match[3])
	return hh*3600 + mm*60 + ss, true
}

// Batches are throttled to stay inside the server's per-minute rate limit;
// overridable for tests.
func importBatchDelay() time.Duration {
	if raw := os.Getenv("JAWA_IMPORT_DELAY_MS"); raw != "" {
		if ms, err := strconv.Atoi(raw); err == nil && ms >= 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 600 * time.Millisecond
}

type historyLine struct {
	text   string
	lineNo int
	clock  int // seconds since midnight
	dayIdx int
}

type historyAnchor struct {
	dayIdx int
	date   time.Time // midnight of the anchor's day
}

// Reads the whole file, dating combat lines as documented above, and uploads
// them in order. Returns the end offset to resume live tailing from, and
// whether the import completed (false = upload failure; retry next cycle).
func importHistory(config Config, path string, sink statusSink) (int64, bool) {
	file, err := os.Open(path)
	if err != nil {
		return 0, false
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return 0, false
	}

	// Pass 1: collect combat lines with day indexes, and date anchors.
	reader := bufio.NewReaderSize(file, 256*1024)
	var lines []historyLine
	var anchors []historyAnchor
	dayIdx := 0
	lastClock := -1
	lastLine := ""
	lineNo := 0
	rollover := func(clock int) {
		if lastClock >= 0 && clock < lastClock-3600 {
			dayIdx += 1
		}
		lastClock = clock
	}
	for {
		raw, readErr := reader.ReadString('\n')
		line := strings.TrimRight(strings.TrimPrefix(raw, "\uFEFF"), "\r\n")
		lineNo += 1
		if line != "" && line != lastLine {
			lastLine = line
			if marker, ok := parseLoginMarker(line); ok {
				clock := marker.Hour()*3600 + marker.Minute()*60 + marker.Second()
				rollover(clock)
				anchors = append(anchors, historyAnchor{dayIdx, time.Date(marker.Year(), marker.Month(), marker.Day(), 0, 0, 0, 0, time.Local)})
			} else if combatSuspect(line) {
				if clock, ok := lineClockSeconds(line); ok {
					rollover(clock)
					lines = append(lines, historyLine{line, lineNo, clock, dayIdx})
				}
			}
		}
		if readErr != nil {
			break
		}
	}
	file.Close()
	if len(lines) == 0 {
		return info.Size(), true
	}

	// No markers anywhere: pin the last line's day to the file's mtime.
	if len(anchors) == 0 {
		modified := info.ModTime()
		anchors = append(anchors, historyAnchor{
			lines[len(lines)-1].dayIdx,
			time.Date(modified.Year(), modified.Month(), modified.Day(), 0, 0, 0, 0, time.Local),
		})
	}

	// Date each line from the nearest anchor at-or-before its day index;
	// lines before the first anchor count backwards from it.
	dateFor := func(idx int) time.Time {
		chosen := anchors[0]
		for _, anchor := range anchors {
			if anchor.dayIdx <= idx {
				chosen = anchor
			} else {
				break
			}
		}
		return chosen.date.AddDate(0, 0, idx-chosen.dayIdx)
	}

	imported := 0
	var batch []ChatEvent
	flush := func() bool {
		if len(batch) == 0 {
			return true
		}
		result, err := uploadCombat(config, batch)
		if err != nil {
			sink.status(fmt.Sprintf("History import paused for %s: %v", shortName(path), err))
			return false
		}
		imported += result.Stored
		batch = batch[:0]
		time.Sleep(importBatchDelay())
		return true
	}

	for _, line := range lines {
		day := dateFor(line.dayIdx)
		stamped := day.Add(time.Duration(line.clock) * time.Second)
		batch = append(batch, ChatEvent{
			Raw:         line.text,
			At:          stamped.Format(time.RFC3339),
			Fingerprint: lineFingerprint(path, int64(line.lineNo), 0, line.text),
		})
		if len(batch) >= 500 {
			if !flush() {
				return 0, false
			}
			if imported > 0 && imported%10_000 < 500 {
				sink.status(fmt.Sprintf("Importing %s history: %d of ~%d events", shortName(path), imported, len(lines)))
			}
		}
	}
	if !flush() {
		return 0, false
	}
	if imported > 0 {
		sink.status(fmt.Sprintf("Imported %d combat events from %s", imported, shortName(path)))
	}
	return info.Size(), true
}

func shortName(path string) string {
	parts := strings.Split(strings.ReplaceAll(path, "\\", "/"), "/")
	return parts[len(parts)-1]
}
