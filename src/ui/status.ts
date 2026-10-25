/**
 * Renders the compact active-preset badge that names the active preset in
 * Pi's status bar.
 */
import type { ActivePresetState } from "../types.js";
import type { Theme } from "@earendil-works/pi-coding-agent";

/** Status-bar command slot that opens the preset picker. */
export const STATUS_KEY = "command:/presets";

/** Render the active-preset status badge. */
export function renderStatusBadge(
  active: ActivePresetState | undefined,
  theme: Theme | undefined,
  showInactiveStatus = true,
): string | undefined {
  if (!active) {
    return showInactiveStatus ? dim(theme, "Preset: none") : undefined;
  }

  const label = dim(theme, `Preset: ${active.name}`);

  if (!active.dirty) return label;

  return `${label}${warning(theme, "!")}`;
}

function dim(theme: Theme | undefined, text: string): string {
  return theme?.fg("dim", text) ?? text;
}

function warning(theme: Theme | undefined, text: string): string {
  return theme?.fg("warning", text) ?? text;
}
