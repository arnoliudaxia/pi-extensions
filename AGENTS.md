# Presets Plus

Presets Plus bundles a model, thinking level, tools, and system prompt into
switchable presets. This is a single-package repository at
`arnoliudaxia/pi-extensions`: `src/`, `tests/`, and `openspec/` live at the
root.

## Workflow

- Install dependencies with `pnpm install`. Prefer mise tasks from `mise.toml`:
  `mise run check` checks formatting, types, lint, and tests; `mise run format`
  and `mise run lint-fix` apply fixes. If mise is unavailable, use the
  equivalent commands in [CONTRIBUTING.md](CONTRIBUTING.md), not invented npm
  scripts.
- User-visible changes need a changeset; see
  [.changeset/README.md](.changeset/README.md). Versioning and publishing need
  maintainer approval and appropriate registry permissions. Preserve Sherif
  Fanous's authorship, the MIT license, and released changelog entries.
- Runtime helpers come from the npm dependency
  `@sherif-fanous/pi-extensions-core`, pinned to `0.1.0`; there is no local core
  workspace. Test doubles and text/render assertions from the former private
  testing package live in `tests/support/`. Reuse them instead of making fakes.
- Plan behavior changes under `openspec/changes/`; a small fix needs no
  proposal. Run OpenSpec from the repository root. Keep spec folder names, use
  RFC 2119 requirements and GIVEN/WHEN/THEN scenarios, and validate the affected
  change.

## Code, configuration, and UI

- Keep registration in `src/index.ts`, command dispatch in
  `src/commands/presets/`, storage in `src/store/`, and UI in `src/ui/`. Reuse
  core's error, configuration, report, and TUI helpers before adding a helper.
- Guard commands with `guardCommand` and throwing events with `onEvent`, using
  `EXTENSION_NAME`. Use `describeError` or `describeErrorSentence` for thrown
  values. Expected validation failures return structured results or warnings;
  throw for unexpected I/O failures and programmer errors. Collect warnings at
  the UI boundary, never notify from storage or once per warning.
- Keep no module-level cache of on-disk configuration. Read, migrate, and write
  Project files only while Pi trusts the project. Missing files silently use
  defaults; unknown versions warn and must not be overwritten. Migrations write
  the new file before deleting old ones and never replace an existing new file.
  Tests move the agent directory only through `PI_CODING_AGENT_DIR`, using
  `createTempConfigDirs` from `tests/support/`.
- Reload and session switches can repeat `session_start`. Dispose previous
  session resources and clean up on shutdown; do not notify during shutdown.
- Guard custom terminal components with `isInteractiveTui(ctx)`. Dialogs such as
  `select` and `confirm` can also work in RPC mode: gate those on `ctx.hasUI`.
  Keep print and JSON paths non-interactive. Reuse core's frames, scrolling, key
  hints, and list navigation; follow Pi keybindings for application actions.
  Keep every rendered line within its width and test narrow terminals.
- Open source files and exported declarations with short JSDoc. Document actions
  in the imperative, values with noun phrases. Skip signature-restating tags and
  comments that narrate code or history. Use optional final parameters for test
  seams, not a dependency-injection layer.

## Text

- Use `Presets Plus` in prose, `Pi` for the host, `pi` for its binary, and
  `User` and `Project` for scopes. Keep literal command names and `presets-plus`
  keys. User documentation describes behavior and limits, not internal
  mechanisms.
- Use active voice and sentence-case prose/headings, without em or en dashes or
  stock filler. UI titles and action labels use Title Case; key/value labels use
  sentence case. Command descriptions start with a verb. Notifications and empty
  states are complete sentences; key hints are short actions.
- Use `info` for outcomes, including no change; `warning` for fixable user
  issues; `error` for unexpected failures. Unprompted messages name Presets
  Plus; replies to a command need not. Reports use core's report helpers, with
  configuration before warnings. Startup and explicit reload collect
  configuration warnings.
- Keep the README's command, key, configuration, migration, and mode limitations
  accurate. Say testing targets the latest stable Pi, not an unverified minimum.
  Format Markdown at 80 columns. Do not rewrite published changelog history.

## Preset invariants

- Field labels, dialog titles, and action labels shared by more than one surface
  live in `src/ui/labels.ts`. Read them from there, so one spelling reaches
  every surface.
- `SUBCOMMANDS` in `src/commands/presets/router.ts` is the one registry behind
  the completions, the dispatch, and the usage warning's forms.
- Read and save `config.json` only through `PRESETS_PLUS_CONFIG`, the core
  config handle `src/store/config.ts` defines. Session start adds the version 1
  migration to the loaded outcome and passes its other startup warnings
  (restore, `--preset`, policy, hotkeys) to `notify` as extras.
- An operation reads its configuration once, with `loadPresetsConfig(ctx)` in
  `src/store/api.ts`. The result holds the merged presets, the settings, the
  compiled user policy's rules, and every warning (settings, presets, and both
  policies) in `config`, which session start, `/presets reload`, status, and
  `/presets policy` show. Activation never reports policy warnings. A caller
  that already holds the result passes it to `activate` as `config` instead of
  reading the file again. A save reads only its own scope, and refuses when any
  section of that file has a warning.
- Every activation goes through `activate(ctx, pi, session, request)` in
  `src/activation/activate.ts`, and session start's restore, `--preset`, and
  policy default through `activateAtStartup` there. The request gives the
  preset, or its name, and the trigger (`command`, `flag`, `hotkey`, `picker`),
  which decides the wording and where warnings go. A name alone resolves through
  `findPresetByName`, the one project-then-user rule, which `show-prompt` uses
  too. Callers keep only their parsing and their own UI.
- `ActivePresetSession` in `src/activation/session.ts` holds the one record of
  the active preset: what it declared and, unless it was reattached from the
  session branch, the baseline and the values its overlay wrote. It makes every
  model, thinking level, and tools write (`apply`, `clear`) inside its
  self-trigger guard, which the drift handlers check. `assess(ctx, pi)` reads Pi
  once and is the one comparison with the active preset: drift reasons for the
  badge and the picker, and each field's classification for status and clear.
  Read Pi's state through it rather than comparing it by hand; `decideClear`
  stays a pure function of the assessment.
- Every hotkey rule lives in `src/hotkey-rules.ts`, a pure module: parsing and
  normalizing, Pi's built-in keys, which preset owns a key across the merged
  list (shadowed presets own nothing, the earlier preset wins), whether a hotkey
  changed, and the warning wording. `loadPresetsConfig` annotates presets with
  `analyzeHotkeys`, the editor asks `diagnoseDraftHotkey` and `hotkeyChanged`,
  and `HotkeyRegistry.bindForSession(presets, …)` registers the keys
  `analyzeHotkeys` assigns. Don't compare or parse hotkeys anywhere else.
- Deleting the active preset leaves the session attached on purpose:
  `/presets clear` still needs the record to restore the baseline. The badge
  keeps the name and status reports the preset as no longer loaded.
