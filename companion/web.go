package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Local settings UI: the tray's "Open Settings" serves this page on
// 127.0.0.1 only. It replaces hand-editing config.json — token, folders,
// poll rates, and the DPS toggle all apply live, no restart. Writes are
// guarded by a per-launch CSRF token so a hostile web page can't reach the
// endpoints, and the listener never binds a public interface.

var (
	settingsMu   sync.Mutex
	settingsBase string
	csrfToken    = mintCSRF()
)

func mintCSRF() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func settingsURL() string {
	settingsMu.Lock()
	defer settingsMu.Unlock()
	return settingsBase
}

func startSettingsServer() {
	listener, err := net.Listen("tcp", "127.0.0.1:47365")
	if err != nil {
		listener, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		hub.status(fmt.Sprintf("Settings UI unavailable: %v", err))
		return
	}
	settingsMu.Lock()
	settingsBase = "http://" + listener.Addr().String()
	settingsMu.Unlock()

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleSettingsPage)
	mux.HandleFunc("/api/status", handleStatus)
	mux.HandleFunc("/api/save", handleSave)
	mux.HandleFunc("/api/test", handleTest)
	go func() { _ = http.Serve(listener, mux) }()
}

func openBrowser(url string) {
	if url == "" {
		return
	}
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		_ = exec.Command("open", url).Start()
	default:
		_ = exec.Command("xdg-open", url).Start()
	}
}

// DNS-rebinding guard: the page is only ever served for loopback hosts.
func localRequest(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func guarded(w http.ResponseWriter, r *http.Request) bool {
	if !localRequest(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return false
	}
	return true
}

func csrfOK(r *http.Request) bool {
	return r.Header.Get("X-Jawa-Csrf") == csrfToken
}

type settingsPayload struct {
	Token           *string  `json:"token"`
	Server          string   `json:"server"`
	MailDirs        []string `json:"mailDirs"`
	ChatLogDirs     []string `json:"chatLogDirs"`
	PollSeconds     int      `json:"pollSeconds"`
	ChatPollSeconds int      `json:"chatPollSeconds"`
	DisableDps      bool     `json:"disableDps"`
}

func cleanDirs(dirs []string) []string {
	var out []string
	for _, dir := range dirs {
		dir = strings.Trim(strings.TrimSpace(dir), `"`)
		if dir != "" {
			out = append(out, dir)
		}
	}
	if out == nil {
		out = []string{}
	}
	return out
}

func applyPayload(current Config, payload settingsPayload) Config {
	next := current
	if payload.Token != nil && strings.TrimSpace(*payload.Token) != "" {
		next.Token = strings.TrimSpace(*payload.Token)
	}
	if server := strings.TrimRight(strings.TrimSpace(payload.Server), "/"); server != "" {
		next.Server = server
	}
	next.MailDirs = cleanDirs(payload.MailDirs)
	next.ChatLogDirs = cleanDirs(payload.ChatLogDirs)
	next.PollSeconds = payload.PollSeconds
	if next.PollSeconds < 15 {
		next.PollSeconds = 60
	}
	next.ChatPollSeconds = payload.ChatPollSeconds
	if next.ChatPollSeconds < 1 {
		next.ChatPollSeconds = 2
	}
	next.DisableDps = payload.DisableDps
	return next
}

func handleSave(w http.ResponseWriter, r *http.Request) {
	if !guarded(w, r) {
		return
	}
	if r.Method != http.MethodPost || !csrfOK(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var payload settingsPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	next := applyPayload(conf(), payload)
	if err := saveConfig(next); err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "message": err.Error()})
		return
	}
	hub.status("Settings saved")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func handleTest(w http.ResponseWriter, r *http.Request) {
	if !guarded(w, r) {
		return
	}
	if r.Method != http.MethodPost || !csrfOK(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var payload settingsPayload
	_ = json.NewDecoder(r.Body).Decode(&payload)
	candidate := applyPayload(conf(), payload)
	if !tokenConfigured(candidate) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "message": "No token yet — create one at " + candidate.Server + "/account"})
		return
	}
	request, err := http.NewRequest(http.MethodGet, candidate.Server+"/api/combat/live?after=0", nil)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "message": err.Error()})
		return
	}
	request.Header.Set("Authorization", "Bearer "+candidate.Token)
	response, err := httpClient.Do(request)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "message": "Could not reach " + candidate.Server})
		return
	}
	defer response.Body.Close()
	switch {
	case response.StatusCode == http.StatusUnauthorized:
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "message": "Token rejected — create a fresh one at " + candidate.Server + "/account"})
	case response.StatusCode >= 200 && response.StatusCode <= 299:
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "message": "Connected — token accepted"})
	default:
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "message": fmt.Sprintf("Server returned HTTP %d", response.StatusCode)})
	}
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	if !guarded(w, r) {
		return
	}
	config := conf()
	mailDirs := discoverMailDirs(config.MailDirs)
	chatLogs := discoverChatLogs(config.ChatLogDirs, config.MailDirs)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"version":         version,
		"tokenSet":        tokenConfigured(config),
		"server":          config.Server,
		"mailDirs":        config.MailDirs,
		"chatLogDirs":     config.ChatLogDirs,
		"pollSeconds":     config.PollSeconds,
		"chatPollSeconds": config.ChatPollSeconds,
		"disableDps":      config.DisableDps,
		"foundMailDirs":   mailDirs,
		"foundChatLogs":   chatLogs,
		"recent":          hub.recent(),
		"configPath":      configPath(),
		"now":             time.Now(),
	})
}

func handleSettingsPage(w http.ResponseWriter, r *http.Request) {
	if !guarded(w, r) {
		return
	}
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = settingsTemplate.Execute(w, map[string]string{"Csrf": csrfToken, "Version": version})
}

var settingsTemplate = template.Must(template.New("settings").Parse(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jawa Tracks Companion</title>
<style>
  :root { --bg:#0a0c10; --panel:#181b22; --line:#272c38; --dim:#909ab8; --fg:#e2e5ec; --accent:#ffaa00; --plasma:#33ddff; --red:#ff3344; --green:#00cc66; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:20px; letter-spacing:.5px; margin:0; }
  h1 span { color:var(--accent); }
  .sub { color:var(--dim); font-size:12px; margin:2px 0 22px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:16px; }
  .panel h2 { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim); margin:0 0 12px; }
  label { display:block; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--dim); margin:12px 0 4px; }
  input[type=text], input[type=password], input[type=number], textarea {
    width:100%; background:#0f1116; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:8px 10px; font:13px/1.4 Consolas, monospace;
  }
  textarea { min-height:64px; resize:vertical; }
  input:focus, textarea:focus { outline:none; border-color:var(--plasma); }
  .hint { color:var(--dim); font-size:11px; margin-top:3px; }
  .row { display:flex; gap:14px; flex-wrap:wrap; }
  .row > div { flex:1; min-width:140px; }
  .toggle { display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; color:var(--fg); }
  .toggle input { width:16px; height:16px; accent-color:var(--accent); }
  .actions { display:flex; gap:10px; align-items:center; margin-top:18px; }
  button { background:var(--accent); color:#0a0c10; border:0; border-radius:6px; padding:9px 18px; font-weight:600; font-size:13px; cursor:pointer; }
  button.ghost { background:transparent; color:var(--plasma); border:1px solid var(--line); }
  button:hover { filter:brightness(1.1); }
  #note { font-size:12px; }
  .ok { color:var(--green); } .bad { color:var(--red); }
  .stat { display:flex; gap:8px; align-items:baseline; font-size:12px; color:var(--dim); margin-bottom:6px; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--line); display:inline-block; }
  .dot.on { background:var(--green); }
  ul.paths { margin:6px 0 0; padding-left:18px; color:var(--dim); font:11px Consolas, monospace; }
  #feed { font:11px/1.7 Consolas, monospace; color:var(--dim); max-height:180px; overflow-y:auto; margin:0; padding:0; list-style:none; }
  #feed b { color:var(--fg); font-weight:normal; }
</style></head><body><div class="wrap">
  <h1>JAWA <span>TRACKS</span> COMPANION</h1>
  <div class="sub">v{{.Version}} · streams SWG mail &amp; combat logs to jawatracks.com</div>

  <div class="panel">
    <h2>Status</h2>
    <div class="stat"><span id="tokendot" class="dot"></span><span id="tokentext">Checking…</span></div>
    <div class="stat">Mail folders found: <b id="mailcount">–</b> · Chat logs found: <b id="chatcount">–</b></div>
    <ul class="paths" id="paths"></ul>
    <label>Recent activity</label>
    <ul id="feed"></ul>
  </div>

  <div class="panel">
    <h2>Connection</h2>
    <label for="token">Companion token</label>
    <input type="password" id="token" placeholder="paste a jtk_… token, or leave blank to keep the saved one">
    <div class="hint">Create one at <a id="acctlink" href="https://jawatracks.com/account" target="_blank" style="color:var(--plasma)">jawatracks.com/account</a> — it is stored only on this PC.</div>
    <label for="server">Server</label>
    <input type="text" id="server" value="https://jawatracks.com">
  </div>

  <div class="panel">
    <h2>Folders</h2>
    <label for="maildirs">Mail folders (one per line, blank = auto-detect)</label>
    <textarea id="maildirs" placeholder="C:\Program Files (x86)\StarWarsGalaxies"></textarea>
    <div class="hint">Game install roots, mail_&lt;Character&gt; folders, or SWGAide archives all work.</div>
    <label for="chatdirs">Chat log folders or files (one per line, blank = auto-detect)</label>
    <textarea id="chatdirs" placeholder="C:\Program Files (x86)\StarWarsGalaxies\profiles"></textarea>
    <div class="hint">Needs /chatLog enabled in game. Powers the live Combat Monitor.</div>
  </div>

  <div class="panel">
    <h2>Behavior</h2>
    <div class="row">
      <div><label for="poll">Mail poll (seconds)</label><input type="number" id="poll" min="15" value="60"></div>
      <div><label for="chatpoll">Combat poll (seconds)</label><input type="number" id="chatpoll" min="1" value="2"></div>
    </div>
    <div class="toggle"><input type="checkbox" id="dps" checked><label for="dps" style="margin:0;text-transform:none;font-size:13px;letter-spacing:0;color:var(--fg)">Stream combat log (live DPS monitor)</label></div>
    <div class="actions">
      <button id="save">Save Settings</button>
      <button id="test" class="ghost">Test Connection</button>
      <span id="note"></span>
    </div>
  </div>
</div>
<script>
const CSRF = {{.Csrf}};
const $ = (id) => document.getElementById(id);
let loaded = false;

function form() {
  return {
    token: $("token").value,
    server: $("server").value,
    mailDirs: $("maildirs").value.split("\n"),
    chatLogDirs: $("chatdirs").value.split("\n"),
    pollSeconds: parseInt($("poll").value, 10) || 60,
    chatPollSeconds: parseInt($("chatpoll").value, 10) || 2,
    disableDps: !$("dps").checked,
  };
}

async function refresh() {
  try {
    const s = await (await fetch("/api/status")).json();
    $("tokendot").className = "dot" + (s.tokenSet ? " on" : "");
    $("tokentext").textContent = s.tokenSet ? "Token saved — uploading as it finds new data" : "No token yet — paste one below and Save";
    $("mailcount").textContent = (s.foundMailDirs || []).length;
    $("chatcount").textContent = (s.foundChatLogs || []).length;
    $("paths").innerHTML = [...(s.foundMailDirs||[]).slice(0,4), ...(s.foundChatLogs||[]).slice(0,4)]
      .map(p => "<li>" + p.replace(/</g,"&lt;") + "</li>").join("");
    $("feed").innerHTML = (s.recent || []).slice(0, 30)
      .map(e => "<li><b>" + new Date(e.at).toLocaleTimeString() + "</b> " + e.text.replace(/</g,"&lt;") + "</li>").join("");
    if (!loaded) {
      loaded = true;
      $("server").value = s.server;
      $("maildirs").value = (s.mailDirs || []).join("\n");
      $("chatdirs").value = (s.chatLogDirs || []).join("\n");
      $("poll").value = s.pollSeconds;
      $("chatpoll").value = s.chatPollSeconds;
      $("dps").checked = !s.disableDps;
      $("acctlink").href = s.server + "/account";
    }
  } catch { $("tokentext").textContent = "Companion not responding"; }
}

async function post(path) {
  const res = await fetch(path, { method: "POST", headers: { "X-Jawa-Csrf": CSRF, "Content-Type": "application/json" }, body: JSON.stringify(form()) });
  return res.json();
}

$("save").onclick = async () => {
  const r = await post("/api/save");
  $("note").textContent = r.ok ? "Saved — applies immediately" : (r.message || "Save failed");
  $("note").className = r.ok ? "ok" : "bad";
  if (r.ok) $("token").value = "";
};
$("test").onclick = async () => {
  $("note").textContent = "Testing…"; $("note").className = "";
  const r = await post("/api/test");
  $("note").textContent = r.message;
  $("note").className = r.ok ? "ok" : "bad";
};

refresh();
setInterval(refresh, 2000);
</script></body></html>`))
