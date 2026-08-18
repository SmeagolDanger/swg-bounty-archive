package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type uploadResult struct {
	Archived   int `json:"archived"`
	Duplicates int `json:"duplicates"`
	Sales      int `json:"sales"`
}

var httpClient = &http.Client{Timeout: 60 * time.Second}

// Uploads one character's batch; the server dedupes by content hash, so
// retries and overlaps are always safe.
func uploadBatch(config Config, character string, mails []MailFile) (uploadResult, error) {
	payload := struct {
		CharacterName string   `json:"characterName"`
		Mails         []string `json:"mails"`
	}{CharacterName: character, Mails: make([]string, 0, len(mails))}
	for _, mail := range mails {
		payload.Mails = append(payload.Mails, mail.Raw)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return uploadResult{}, err
	}
	request, err := http.NewRequest(http.MethodPost, config.Server+"/api/mail/upload", bytes.NewReader(body))
	if err != nil {
		return uploadResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+config.Token)
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return uploadResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized {
		return uploadResult{}, fmt.Errorf("token rejected (401) — create a fresh token at %s/account", config.Server)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return uploadResult{}, fmt.Errorf("server returned HTTP %d", response.StatusCode)
	}
	var result uploadResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return uploadResult{}, err
	}
	return result, nil
}

type combatResult struct {
	Stored     int `json:"stored"`
	Duplicates int `json:"duplicates"`
	Unparsed   int `json:"unparsed"`
	Ignored    int `json:"ignored"`
}

// Ships a batch of combat lines; the server dedupes by fingerprint, so
// retries after a failed poll are always safe.
func uploadCombat(config Config, events []ChatEvent) (combatResult, error) {
	payload := struct {
		Events []ChatEvent `json:"events"`
	}{Events: events}
	body, err := json.Marshal(payload)
	if err != nil {
		return combatResult{}, err
	}
	request, err := http.NewRequest(http.MethodPost, config.Server+"/api/combat/upload", bytes.NewReader(body))
	if err != nil {
		return combatResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+config.Token)
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return combatResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized {
		return combatResult{}, fmt.Errorf("token rejected (401) — create a fresh token at %s/account", config.Server)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return combatResult{}, fmt.Errorf("server returned HTTP %d", response.StatusCode)
	}
	var result combatResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return combatResult{}, err
	}
	return result, nil
}
