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
