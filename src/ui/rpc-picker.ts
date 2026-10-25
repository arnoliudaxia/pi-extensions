/** Browse loaded presets through Pi's standard selection prompt for RPC clients. */
import { EXTENSION_NAME } from "../extension-name.js";
import type { LoadedPreset } from "../types.js";
import {
  MANAGE_PRESETS_LABEL,
  MODEL_LABEL,
  SCOPE_LABEL,
  STATUS_LABEL,
  THINKING_LABEL,
} from "./labels.js";
import { formatScopeName, formatThinkingLevel } from "./widgets.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Select an exact loaded preset, or return undefined when the prompt is cancelled. */
export async function openRpcPicker(
  ctx: Pick<ExtensionContext, "ui">,
  presets: readonly LoadedPreset[],
  onManage?: () => Promise<void>,
): Promise<LoadedPreset | undefined> {
  if (presets.length === 0 && !onManage) {
    ctx.ui.notify(
      "No presets loaded. Add one to your configuration and try again.",
      "info",
    );

    return undefined;
  }

  const options = new Map(
    presets.map((preset, index) => [formatOption(preset, index), preset]),
  );
  const selected = await ctx.ui.select(EXTENSION_NAME, [
    ...options.keys(),
    ...(onManage ? [MANAGE_PRESETS_LABEL] : []),
  ]);

  if (onManage && selected === MANAGE_PRESETS_LABEL) {
    await onManage();

    return undefined;
  }

  return selected === undefined ? undefined : options.get(selected);
}

/** Keep user-controlled values literal when Pi Web renders options as Markdown. */
function formatMarkdownCode(value: string): string {
  const singleLine = value.replaceAll(/[\r\n]+/gu, "↵");
  const longestBacktickRun = Math.max(
    0,
    ...(singleLine.match(/`+/gu)?.map((run) => run.length) ?? []),
  );
  const delimiter = "`".repeat(longestBacktickRun + 1);

  // Padding prevents a trailing backtick in the value from joining the closer.
  return `${delimiter} ${singleLine} ${delimiter}`;
}

function formatOption(preset: LoadedPreset, index: number): string {
  const thinking = [
    formatThinkingLevel(preset.thinkingLevel ?? "off"),
    ...(preset.clampWarning ? ["(will be clamped)"] : []),
  ].join(" ");
  const notes = preset.shadowed ? " · Project wins by name" : "";

  return [
    `**${index + 1}.** ${formatMarkdownCode(preset.name)}`,
    `${SCOPE_LABEL}: ${formatScopeName(preset.scope)} · ${MODEL_LABEL}: ${formatMarkdownCode(`${preset.provider} / ${preset.model}`)}`,
    `${THINKING_LABEL}: ${thinking} · ${STATUS_LABEL}: ${formatPickerStatus(preset)}${notes}`,
  ].join("  \n");
}

function formatPickerStatus(preset: LoadedPreset): string {
  switch (preset.unavailable) {
    case "no-key":
      return "Unavailable: provider has no API key";
    case "no-model":
      return "Unavailable: model is no longer available";
    case undefined:
      return "Available";
    default:
      return "Available";
  }
}
