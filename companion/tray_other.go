//go:build !windows

package main

// Non-Windows builds (development, testing) run as a plain console loop.
func platformRun(config Config) {
	runLoop(config, statusLogger{})
}
