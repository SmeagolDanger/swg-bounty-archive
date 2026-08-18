package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestApplyPayloadMerge(t *testing.T) {
	current := Config{Token: "jtk_old", Server: "https://jawatracks.com", PollSeconds: 60, ChatPollSeconds: 2}

	kept := applyPayload(current, settingsPayload{Token: strPtr("  "), Server: "https://jawatracks.com/", PollSeconds: 5, ChatPollSeconds: 0})
	if kept.Token != "jtk_old" {
		t.Errorf("blank token must keep the saved one, got %q", kept.Token)
	}
	if kept.PollSeconds != 60 || kept.ChatPollSeconds != 2 {
		t.Errorf("minimums not enforced: %d %d", kept.PollSeconds, kept.ChatPollSeconds)
	}
	if kept.Server != "https://jawatracks.com" {
		t.Errorf("trailing slash not trimmed: %q", kept.Server)
	}

	replaced := applyPayload(current, settingsPayload{Token: strPtr(" jtk_new "), MailDirs: []string{" C:\\SWG ", "", `"C:\Games"`}})
	if replaced.Token != "jtk_new" {
		t.Errorf("token not replaced: %q", replaced.Token)
	}
	if len(replaced.MailDirs) != 2 || replaced.MailDirs[0] != `C:\SWG` || replaced.MailDirs[1] != `C:\Games` {
		t.Errorf("dirs not cleaned: %v", replaced.MailDirs)
	}
}

func strPtr(s string) *string { return &s }

func TestSaveHandlerGuards(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("APPDATA", t.TempDir())
	setConf(Config{Server: "https://jawatracks.com", PollSeconds: 60, ChatPollSeconds: 2})

	// Missing CSRF header is rejected.
	request := httptest.NewRequest("POST", "http://127.0.0.1:47365/api/save", strings.NewReader(`{"server":"https://evil.example"}`))
	recorder := httptest.NewRecorder()
	handleSave(recorder, request)
	if recorder.Code != 403 {
		t.Fatalf("expected 403 without csrf, got %d", recorder.Code)
	}

	// Non-loopback Host is rejected (DNS rebinding).
	request = httptest.NewRequest("POST", "http://127.0.0.1:47365/api/save", strings.NewReader(`{}`))
	request.Host = "evil.example:47365"
	request.Header.Set("X-Jawa-Csrf", csrfToken)
	recorder = httptest.NewRecorder()
	handleSave(recorder, request)
	if recorder.Code != 403 {
		t.Fatalf("expected 403 for foreign host, got %d", recorder.Code)
	}

	// A proper save applies live.
	request = httptest.NewRequest("POST", "http://127.0.0.1:47365/api/save", strings.NewReader(`{"token":"jtk_test","server":"https://jawatracks.com","pollSeconds":30,"chatPollSeconds":3,"disableDps":true}`))
	request.Header.Set("X-Jawa-Csrf", csrfToken)
	recorder = httptest.NewRecorder()
	handleSave(recorder, request)
	if recorder.Code != 200 {
		t.Fatalf("save failed: %d %s", recorder.Code, recorder.Body.String())
	}
	saved := conf()
	if saved.Token != "jtk_test" || saved.PollSeconds != 30 || saved.ChatPollSeconds != 3 || !saved.DisableDps {
		t.Errorf("config not applied live: %+v", saved)
	}
}
