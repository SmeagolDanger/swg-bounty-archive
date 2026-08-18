//go:build windows

package main

import (
	"fmt"

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
		settings := systray.AddMenuItem("Open Settings", "Configure token, folders, and the DPS stream")
		account := systray.AddMenuItem("Open jawatracks.com/account", "Manage tokens")
		systray.AddSeparator()
		quit := systray.AddMenuItem("Quit", "Stop uploading")

		go func() {
			for {
				select {
				case <-settings.ClickedCh:
					openBrowser(settingsURL())
				case <-account.ClickedCh:
					openBrowser(conf().Server + "/account")
				case <-quit.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
		hub.forward = trayStatus{item: status}.status
		go runLoop(config, hub)
	}, func() {})
}

type trayStatus struct {
	item *systray.MenuItem
}

func (t trayStatus) status(text string) {
	t.item.SetTitle(fmt.Sprintf("%.60s", text))
}
