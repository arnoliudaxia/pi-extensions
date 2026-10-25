# Add complete RPC preset management

## Why

Pi Web can select an existing preset, but creation and maintenance still require
the terminal picker or hand-editing configuration.

## What changes

- Add `/presets manage` and a Manage Presets entry in the RPC picker.
- Edit all persisted fields through standard dialogs without normalizing
  untouched values. Offer Save and Save And Apply, not unsaved draft Test.
- Reuse storage, policy, activation, and session identity handling.
- Serialize RPC commits, reject stale snapshots, and preserve unsafe files.
- Detect effective hotkey ownership changes after ordering or shadowing.

## Scope

Keep the custom TUI picker, directory defaults, and browser shortcut behavior
unchanged. Do not add a Pi Web-specific UI protocol or publish a package.
