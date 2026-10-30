/** Build safe, current-value RPC menu rows without changing the underlying draft. */
import { stripVTControlCharacters } from "node:util";

import {
  CANCEL_LABEL,
  MODEL_LABEL,
  SAVE_LABEL,
  SCOPE_LABEL,
  THINKING_LABEL,
  TOOLS_LABEL,
} from "../labels.js";
import type { RpcPresetDraft } from "../rpc-editor-types.js";
import { formatScopeName, formatThinkingLevel } from "../widgets.js";

/** Stable field and action identities, independent of their display strings. */
export type RpcMenuChoice =
  | "name"
  | "scope"
  | "provider"
  | "model"
  | "thinkingLevel"
  | "tools"
  | "instructions"
  | "hotkey"
  | "order"
  | "save"
  | "save-apply"
  | "cancel";

const PREVIEW_LENGTH = 60;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Map only the displayed rows to stable identities, including unchanged actions. */
export function buildRpcMenu(
  draft: RpcPresetDraft,
  showTerminalFields = false,
): Map<string, RpcMenuChoice> {
  const { preset } = draft;
  const tools =
    preset.tools === undefined
      ? "Inherit (omitted)"
      : preset.tools.length === 0
        ? "Inherit ([]: empty list)"
        : preview(JSON.stringify(preset.tools));

  return new Map<string, RpcMenuChoice>([
    [`Name: ${preview(preset.name)}`, "name"],
    [`${SCOPE_LABEL}: ${formatScopeName(draft.scope)}`, "scope"],
    [`Provider: ${preview(preset.provider)}`, "provider"],
    [`${MODEL_LABEL}: ${preview(preset.model)}`, "model"],
    [
      `${THINKING_LABEL}: ${preset.thinkingLevel === undefined ? "Default (Off)" : formatThinkingLevel(preset.thinkingLevel)}`,
      "thinkingLevel",
    ],
    [`${TOOLS_LABEL}: ${tools}`, "tools"],
    [`Prompt: ${preview(preset.instructions)}`, "instructions"],
    ...(showTerminalFields
      ? ([
          [`Hotkey: ${preview(preset.hotkey)}`, "hotkey"],
          [`Order: ${preset.order?.toString() ?? "(Unset)"}`, "order"],
        ] as const)
      : []),
    [SAVE_LABEL, "save"],
    ["Save And Apply", "save-apply"],
    [CANCEL_LABEL, "cancel"],
  ]);
}

/** Collapse controls and whitespace, clip whole graphemes, then escape Markdown. */
function preview(value: string | undefined): string {
  if (value === undefined) return "(Unset)";
  if (value.length === 0) return "(Empty)";

  const singleLine = stripVTControlCharacters(value)
    .replaceAll(
      /[\p{Cc}\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu,
      " ",
    )
    .replaceAll(/\s+/gu, " ")
    .trim();

  if (singleLine.length === 0) return "(Whitespace only)";

  const segments: string[] = [];

  for (const part of GRAPHEMES.segment(singleLine)) {
    segments.push(part.segment);

    if (segments.length > PREVIEW_LENGTH) break;
  }

  const clipped =
    segments.length > PREVIEW_LENGTH
      ? `${segments
          .slice(0, PREVIEW_LENGTH - 1)
          .join("")
          .trimEnd()}…`
      : singleLine;

  // RPC clients can render options as Markdown. Never let values become markup.
  return clipped
    .replaceAll("&", "&amp;")
    .replaceAll(/[\\`*_[\]{}<>|~]/gu, "\\$&");
}
