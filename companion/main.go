package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"time"
)

// Jawa Tracks mail companion: watches the SWG profiles mail folders and
// uploads new /mailsave files to jawatracks.com, where vendor and bazaar
// sale mails become the Sales Tracker in the Jawa Tracks app. Uploads are
// content-hash deduplicated end to end, so nothing is ever double-counted.

var version = "dev"

func main() {
	log.SetFlags(log.LstdFlags)
	log.Printf("Jawa Tracks companion %s", version)

	config, err := loadConfig()
	if errors.Is(err, os.ErrNotExist) {
		if err := writeConfigTemplate(); err != nil {
			log.Fatalf("could not write config template: %v", err)
		}
		config, _ = loadConfig()
	} else if err != nil {
		log.Fatalf("could not read %s: %v", configPath(), err)
	}
	setConf(config)

	startSettingsServer()
	if !tokenConfigured(config) {
		hub.status("Not set up yet — open Settings and paste a companion token")
		openBrowser(settingsURL())
	}

	platformRun(config)
}

type statusSink interface {
	status(text string)
}

type statusLogger struct{}

func (statusLogger) status(text string) { log.Print(text) }

// The hub keeps recent status lines for the settings page and forwards the
// newest one to the tray (or console log).
type statusEntry struct {
	At   time.Time `json:"at"`
	Text string    `json:"text"`
}

type statusHub struct {
	mu      sync.Mutex
	entries []statusEntry
	forward func(string)
}

func (h *statusHub) status(text string) {
	h.mu.Lock()
	h.entries = append(h.entries, statusEntry{At: time.Now(), Text: text})
	if len(h.entries) > 50 {
		h.entries = h.entries[len(h.entries)-50:]
	}
	forward := h.forward
	h.mu.Unlock()
	log.Print(text)
	if forward != nil {
		forward(text)
	}
}

func (h *statusHub) recent() []statusEntry {
	h.mu.Lock()
	defer h.mu.Unlock()
	entries := make([]statusEntry, len(h.entries))
	copy(entries, h.entries)
	for left, right := 0, len(entries)-1; left < right; left, right = left+1, right-1 {
		entries[left], entries[right] = entries[right], entries[left]
	}
	return entries
}

var hub = &statusHub{}

func runLoop(_ Config, sink statusSink) {
	state := loadState()
	go chatLoop(sink)

	for {
		config := conf()
		if !tokenConfigured(config) {
			time.Sleep(3 * time.Second)
			continue
		}
		dirs := discoverMailDirs(config.MailDirs)
		if len(dirs) == 0 {
			sink.status("No SWG mail folders found yet — use /mailsave in game, or add your install path in Settings")
		} else {
			uploadCycle(config, &state, dirs, sink)
		}
		time.Sleep(time.Duration(config.PollSeconds) * time.Second)
	}
}

func uploadCycle(config Config, state *State, dirs []string, sink statusSink) {
	batch := collectNewMails(dirs, state.Uploaded, 200)
	if len(batch) == 0 {
		return
	}
	byCharacter := map[string][]MailFile{}
	for _, mail := range batch {
		byCharacter[mail.Character] = append(byCharacter[mail.Character], mail)
	}
	for character, mails := range byCharacter {
		result, err := uploadBatch(config, character, mails)
		if err != nil {
			sink.status(fmt.Sprintf("Upload failed for %s: %v", character, err))
			continue
		}
		for _, mail := range mails {
			state.Uploaded[mail.Hash] = true
		}
		state.save()
		sink.status(fmt.Sprintf("%s: %d archived, %d duplicates, %d sales", character, result.Archived, result.Duplicates, result.Sales))
	}
}

