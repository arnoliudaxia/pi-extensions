/**
 * Holds the field labels, dialog titles, and action labels that the
 * preset surfaces share, so one spelling reaches every surface.
 */

// Field labels shared by status, clear, editor rows, and picker cards.
export const MODEL_LABEL = "Model";
export const THINKING_LABEL = "Thinking level";
export const TOOLS_LABEL = "Tools";
export const PRESET_LABEL = "Preset";
export const SCOPE_LABEL = "Scope";
export const STATUS_LABEL = "Status";

// Per-surface composed labels used by status, policy, and related summaries.
export const BASELINE_MODEL_LABEL = "Baseline model";
export const BASELINE_THINKING_LABEL = "Baseline thinking level";
export const BASELINE_TOOLS_LABEL = "Baseline tools";
export const PRESET_MODEL_LABEL = "Preset model";
export const PRESET_THINKING_LABEL = "Preset thinking level";
export const PRESET_TOOLS_LABEL = "Preset tools";
export const CURRENT_MODEL_LABEL = "Current model";
export const CURRENT_THINKING_LABEL = "Current thinking level";
export const CURRENT_TOOLS_LABEL = "Current tools";
export const RESTORE_LABEL = "Restore";
export const DIRECTORY_LABEL = "Directory";
export const ALLOWED_PRESETS_LABEL = "Allowed presets";
export const PROHIBITED_PRESETS_LABEL = "Prohibited presets";
export const DEFAULT_PRESET_LABEL = "Default preset";
/** Label for the ordered presets that match the default pattern. */
export const DEFAULT_MATCHES_LABEL = "Default matches";

// Dialog titles.
export const ACTIVATION_FAILED_TITLE = "Activation Failed";
export const RELOAD_PROMPT_TITLE = "Reload Pi?";
export const MOVE_PRESET_TITLE = "Move Preset?";
export const PROMPT_EDITOR_TITLE = "Edit Prompt";
export const PROMPT_DIALOG_TITLE = "Preset Prompt";

// Action labels, including the single-use footer labels, kept together so
// the vocabulary stays reviewable in one place.
export const ACTIVATE_LABEL = "Activate";
export const FILTER_LABEL = "Filter";
export const STATUS_ACTION_LABEL = "Status";
export const NEW_LABEL = "New";
export const NEW_PRESET_LABEL = "New Preset";
export const MANAGE_PRESETS_LABEL = "Manage Presets";
export const EDIT_LABEL = "Edit";
export const DUPLICATE_LABEL = "Duplicate";
export const DELETE_LABEL = "Delete";
export const CLEAR_LABEL = "Clear";
export const CLEAR_ACTIVE_PRESET_LABEL = "Clear Active Preset";
export const REORDER_LABEL = "Reorder";
export const CLOSE_LABEL = "Close";
export const BACK_LABEL = "Back";
export const CURSOR_LABEL = "Cursor";
export const MOVE_LABEL = "Move";
export const MOVE_UP_LABEL = "Move Up";
export const MOVE_DOWN_LABEL = "Move Down";
export const VIEW_DETAILS_LABEL = "View Details";
export const APPLY_LABEL = "Apply";
export const PAGE_LABEL = "Page";
export const SCROLL_LABEL = "Scroll";
export const SELECT_LABEL = "Select";
export const SAVE_LABEL = "Save";
export const CANCEL_LABEL = "Cancel";
export const TEST_LABEL = "Test (apply temporarily)";

const MANAGER_ACTION_ICONS: ReadonlyMap<string, string> = new Map([
  [NEW_PRESET_LABEL, "＋"],
  [CLEAR_ACTIVE_PRESET_LABEL, "↺"],
  [STATUS_ACTION_LABEL, "ⓘ"],
  [CLOSE_LABEL, "×"],
  [APPLY_LABEL, "▶"],
  [EDIT_LABEL, "✎"],
  [DUPLICATE_LABEL, "⧉"],
  [MOVE_UP_LABEL, "↑"],
  [MOVE_DOWN_LABEL, "↓"],
  [VIEW_DETAILS_LABEL, "ⓘ"],
  [DELETE_LABEL, "⚠"],
  [BACK_LABEL, "←"],
]);

/** Add a client-safe visual marker to a preset-manager action. */
export function formatManagerAction(label: string): string {
  const icon =
    MANAGER_ACTION_ICONS.get(label) ??
    (label.startsWith(`${MOVE_LABEL} to `) ? "↔" : undefined);

  return icon ? `${icon} ${label}` : label;
}

/** Resolve a displayed action back to its stable routing label. */
export function resolveManagerAction(
  choice: string | undefined,
  labels: readonly string[],
): string | undefined {
  if (choice === undefined) return undefined;

  return labels.find(
    (label) => choice === label || choice === formatManagerAction(label),
  );
}
