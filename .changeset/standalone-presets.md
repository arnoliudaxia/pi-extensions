---
"@sherif-fanous/pi-presets-plus": minor
---

- Changed: **Breaking:** Install Presets Plus from the standalone repository
  root instead of `packages/pi-presets-plus`. Remove the old local installation
  before running `pi install .` at the root, and keep only one copy enabled
- Changed: Install the fork's changes from
  `git:github.com/arnoliudaxia/pi-extensions@feat/rpc-preset-picker`; the
  original npm package does not yet include them
