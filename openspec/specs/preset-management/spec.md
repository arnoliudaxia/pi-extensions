# preset-management Specification

## Purpose

Provide complete preset management through standard interactive dialogs without
requiring custom terminal components or Pi Web-specific extension APIs.

## Requirements

### Requirement: Management is discoverable and mode-aware

`/presets manage` SHALL open the manager in interactive TUI or RPC sessions with
UI. The RPC preset picker SHALL retain exact preset selection and append a
Manage Presets action, including when the preset list is empty. Print, JSON, and
sessions without UI SHALL NOT open management dialogs. Only one manager SHALL be
open per active extension session.

#### Scenario: Enter from an empty picker

- **WHEN** an interactive RPC user opens `/presets` without configured presets
- **THEN** the selection prompt SHALL offer Manage Presets
- **AND** the manager SHALL offer creation without hand-editing a file

### Requirement: Standard dialogs cover the full persisted preset

The editor SHALL use select, input, editor, and confirm dialogs, never custom
terminal components. It SHALL edit name, scope, provider, model, thinking level,
tools, instructions, hotkey, and order. Unmodified fields SHALL retain their
values and optional-field presence. Unknown provider, model, and tool names
SHALL be preservable. Save SHALL NOT require a working API key.

#### Scenario: Preserve optional values and whitespace

- **GIVEN** an existing preset with explicit off, an empty tools array,
  whitespace in instructions, and order equal to zero
- **WHEN** the user changes only its name and saves
- **THEN** those other values SHALL remain unchanged

#### Scenario: Cancel a draft

- **WHEN** a field dialog is cancelled
- **THEN** its prior value SHALL remain unchanged
- **AND** leaving a dirty draft SHALL ask before discarding it

### Requirement: Management reuses storage and activation semantics

The manager SHALL support creation, editing, duplication, deletion, cross-scope
moves, within-scope reordering, details, status, clear, and activation. Names
SHALL be unique within a scope, and same-name presets in different scopes SHALL
remain distinguishable. Duplication SHALL clear the copied hotkey. Moves and
deletion SHALL require confirmation.

#### Scenario: Change an active identity

- **WHEN** the active preset is renamed or moved successfully
- **THEN** its session identity SHALL follow the new name and scope
- **AND** its baseline SHALL remain intact
- **AND** deleting it SHALL leave the attachment available for Clear

### Requirement: Save And Apply uses the persisted preset

Save And Apply SHALL persist first, then activate the exact saved preset through
the shared activation pipeline using a fresh configuration. A rejected or
cancelled activation SHALL NOT undo a successful save. Unsaved draft Test SHALL
NOT be offered.

#### Scenario: Save an unavailable preset

- **WHEN** a valid draft names an unavailable model or missing API key
- **THEN** Save SHALL preserve the draft in configuration
- **AND** Save And Apply SHALL report that it was saved but not applied

### Requirement: Management writes are fresh and guarded

RPC mutations SHALL serialize their read-check-write operations within the
process without holding the queue while awaiting user input. A stale selected
preset or changed ordering SHALL be rejected rather than overwriting external
edits. Every affected scope SHALL be checked for trust and configuration safety
at commit time, while unrelated unsafe scopes SHALL NOT block safe writes. This
guarantee SHALL NOT be described as cross-process locking.

#### Scenario: Reject an edited target

- **GIVEN** another operation changes the target after the editor opens
- **WHEN** the user submits the old draft
- **THEN** the write SHALL be rejected with a conflict explanation
- **AND** the external edit SHALL be retained

#### Scenario: Trust is revoked during an interaction

- **WHEN** project trust is revoked before a Project write is submitted
- **THEN** the write SHALL be rejected and the file SHALL remain unchanged

### Requirement: Existing mode and hotkey behavior is preserved

Management SHALL NOT dynamically bind shortcuts or enable RPC directory
defaults. Relevant saved hotkey changes SHALL explain that Pi's `/reload` is
needed. The existing custom TUI picker and its shortcuts SHALL remain intact.

#### Scenario: Save a hotkey

- **WHEN** a management edit changes a terminal hotkey
- **THEN** the preset SHALL be saved and the user SHALL be told about reload
- **AND** the manager SHALL NOT register a browser shortcut
