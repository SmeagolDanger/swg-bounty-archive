package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// The active config is shared between the mail loop, the chat loop, and the
// settings UI; saves from the UI apply live without a restart.
var (
	configMu     sync.RWMutex
	activeConfig Config
)

func conf() Config {
	configMu.RLock()
	defer configMu.RUnlock()
	return activeConfig
}

func setConf(config Config) {
	configMu.Lock()
	activeConfig = config
	configMu.Unlock()
}

func saveConfig(config Config) error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(configPath(), data, 0o600); err != nil {
		return err
	}
	setConf(config)
	return nil
}

func tokenConfigured(config Config) bool {
	return config.Token != "" && !strings.HasPrefix(config.Token, "PASTE-")
}

// Config lives next to the state file in the per-user app data directory:
// %APPDATA%\JawaTracks on Windows, ~/.config/jawatracks elsewhere.

type Config struct {
	Token       string   `json:"token"`
	Server      string   `json:"server"`
	MailDirs    []string `json:"mailDirs"`
	PollSeconds int      `json:"pollSeconds"`

	// Live DPS stream (chat log tail). Enabled by default; set disableDps
	// to true to turn it off. chatLogDirs may list files or folders.
	ChatLogDirs     []string `json:"chatLogDirs"`
	ChatPollSeconds int      `json:"chatPollSeconds"`
	DisableDps      bool     `json:"disableDps"`
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
	if config.ChatPollSeconds < 1 {
		config.ChatPollSeconds = 2
	}
	return config, err
}

func writeConfigTemplate() error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	template := Config{
		Token:       "",
		Server:      "https://jawatracks.com",
		MailDirs:    []string{},
		PollSeconds: 60,
		ChatLogDirs: []string{},
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
