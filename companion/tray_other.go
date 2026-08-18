//go:build !windows

package main

// Non-Windows builds (development, testing) run as a plain console loop;
// the settings page works the same as on Windows.
func platformRun(config Config) {
	runLoop(config, hub)
}
