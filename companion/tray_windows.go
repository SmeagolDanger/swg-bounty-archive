//go:build windows

package main

import (
	"fmt"
	"os/exec"

	"github.com/getlantern/systray"
)

// Windows runs in the system tray: a status line that mirrors the last
// upload result, a link to the account page, and Quit.

func platformRun(config Config) {
	systray.Run(func() {
		systray.SetTitle("Jawa Tracks")
		systray.SetTooltip("Jawa Tracks mail companion")
		status := systray.AddMenuItem("Starting…", "Last activity")
		status.Disable()
		account := systray.AddMenuItem("Open jawatracks.com/account", "Manage tokens")
		systray.AddSeparator()
		quit := systray.AddMenuItem("Quit", "Stop uploading")

		go func() {
			for {
				select {
				case <-account.ClickedCh:
					_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", config.Server+"/account").Start()
				case <-quit.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
		go runLoop(config, trayStatus{item: status})
	}, func() {})
}

type trayStatus struct {
	item *systray.MenuItem
}

func (t trayStatus) status(text string) {
	t.item.SetTitle(fmt.Sprintf("%.60s", text))
}
