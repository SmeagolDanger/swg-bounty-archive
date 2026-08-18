package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
)

// Config lives next to the state file in the per-user app data directory:
// %APPDATA%\JawaTracks on Windows, ~/.config/jawatracks elsewhere.

type Config struct {
	Token       string   `json:"token"`
	Server      string   `json:"server"`
	MailDirs    []string `json:"mailDirs"`
	PollSeconds int      `json:"pollSeconds"`
}

func configDir() string {
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "JawaTracks")
		}
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "jawatracks")
}

func configPath() string { return filepath.Join(configDir(), "config.json") }
func statePath() string  { return filepath.Join(configDir(), "state.json") }

func loadConfig() (Config, error) {
	config := Config{Server: "https://jawatracks.com", PollSeconds: 60}
	data, err := os.ReadFile(configPath())
	if err != nil {
		return config, err
	}
	err = json.Unmarshal(data, &config)
	if config.Server == "" {
		config.Server = "https://jawatracks.com"
	}
	if config.PollSeconds < 15 {
		config.PollSeconds = 60
	}
	return config, err
}

func writeConfigTemplate() error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	template := Config{
		Token:       "PASTE-YOUR-TOKEN-FROM-jawatracks.com/account",
		Server:      "https://jawatracks.com",
		MailDirs:    []string{},
		PollSeconds: 60,
	}
	data, _ := json.MarshalIndent(template, "", "  ")
	return os.WriteFile(configPath(), data, 0o600)
}

// State tracks which mail files have been uploaded (by content hash).
type State struct {
	Uploaded map[string]bool `json:"uploaded"`
}

func loadState() State {
	state := State{Uploaded: map[string]bool{}}
	if data, err := os.ReadFile(statePath()); err == nil {
		_ = json.Unmarshal(data, &state)
	}
	if state.Uploaded == nil {
		state.Uploaded = map[string]bool{}
	}
	return state
}

func (s State) save() {
	_ = os.MkdirAll(configDir(), 0o755)
	if data, err := json.MarshalIndent(s, "", " "); err == nil {
		_ = os.WriteFile(statePath(), data, 0o600)
	}
}
