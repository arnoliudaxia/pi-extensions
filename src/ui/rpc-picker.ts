/** Browse loaded presets through Pi's standard selection prompt for RPC clients. */
import { EXTENSION_NAME } from "../extension-name.js";
import type { LoadedPreset } from "../types.js";
import {
  MODEL_LABEL,
  SCOPE_LABEL,
  STATUS_LABEL,
  THINKING_LABEL,
} from "./labels.js";
import {
  formatAvailabilityStatus,
  formatScopeName,
  formatThinkingLevel,
} from "./widgets.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Select an exact loaded preset, or return undefined when the prompt is cancelled. */
export async function openRpcPicker(
  ctx: Pick<ExtensionContext, "ui">,
  presets: readonly LoadedPreset[],
): Promise<LoadedPreset | undefined> {
  if (presets.length === 0) {
    ctx.ui.notify(
      "No presets loaded. Add one to your configuration and try again.",
      "info",
    );

    return undefined;
  }

  const options = new Map(
    presets.map((preset, index) => [formatOption(preset, index), preset]),
  );
  const selected = await ctx.ui.select(EXTENSION_NAME, [...options.keys()]);

  return selected === undefined ? undefined : options.get(selected);
}

function formatOption(preset: LoadedPreset, index: number): string {
  const status = [
    formatAvailabilityStatus(preset) || "Available",
    ...(preset.clampWarning ? ["Thinking will be clamped."] : []),
    ...(preset.shadowed ? ["Project preset takes precedence by name."] : []),
  ].join(" ");

  return [
    `${index + 1}. ${JSON.stringify(preset.name)}`,
    `${SCOPE_LABEL}: ${formatScopeName(preset.scope)}`,
    `${MODEL_LABEL}: ${preset.provider} / ${preset.model}`,
    `${THINKING_LABEL}: ${formatThinkingLevel(preset.thinkingLevel ?? "off")}`,
    `${STATUS_LABEL}: ${status}`,
  ].join(" · ");
}
