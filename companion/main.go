package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

// Jawa Tracks mail companion: watches the SWG profiles mail folders and
// uploads new /mailsave files to jawatracks.com, where vendor and bazaar
// sale mails become the Sales Tracker in the Jawa Tracks app. Uploads are
// content-hash deduplicated end to end, so nothing is ever double-counted.

var version = "dev"

func main() {
	log.SetFlags(log.LstdFlags)
	log.Printf("Jawa Tracks mail companion %s", version)

	config, err := loadConfig()
	if errors.Is(err, os.ErrNotExist) {
		if err := writeConfigTemplate(); err != nil {
			log.Fatalf("could not write config template: %v", err)
		}
		log.Printf("First run: wrote %s", configPath())
		log.Printf("1) Sign in at https://jawatracks.com/account and create a companion token")
		log.Printf("2) Paste it into the config file's \"token\" field")
		log.Printf("3) Start this program again")
		pause()
		return
	}
	if err != nil {
		log.Fatalf("could not read %s: %v", configPath(), err)
	}
	if config.Token == "" || strings.HasPrefix(config.Token, "PASTE-") {
		log.Printf("No token configured yet — edit %s", configPath())
		log.Printf("Create a token at %s/account", config.Server)
		pause()
		return
	}

	platformRun(config)
}

type statusSink interface {
	status(text string)
}

type statusLogger struct{}

func (statusLogger) status(text string) { log.Print(text) }

func runLoop(config Config, sink statusSink) {
	state := loadState()
	interval := time.Duration(config.PollSeconds) * time.Second

	for {
		dirs := discoverMailDirs(config.MailDirs)
		if len(dirs) == 0 {
			sink.status("No SWG mail folders found yet — use /mailsave in game, or add your install path to mailDirs in config.json")
		} else {
			uploadCycle(config, &state, dirs, sink)
		}
		time.Sleep(interval)
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

func pause() {
	fmt.Println("Press Enter to close.")
	_, _ = fmt.Scanln()
}
