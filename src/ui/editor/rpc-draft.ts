/** Clone, compare, and validate RPC drafts without storage or session effects. */
import { diagnoseDraftHotkey } from "../../hotkey-rules.js";
import {
  samePresetIdentity,
  type PresetIdentity,
} from "../../preset-identity.js";
import { validatePresetShape } from "../../store/validate.js";
import type { LoadedPreset, Preset } from "../../types.js";
import type { RpcDraftIssue, RpcPresetDraft } from "../rpc-editor-types.js";

/** Existing identities and trust constraints used again at the save boundary. */
export interface RpcDraftValidationOptions {
  readonly presets: readonly LoadedPreset[];
  readonly replaces?: PresetIdentity;
  readonly projectTrusted?: boolean;
}

const PRESET_FIELDS = [
  "name",
  "provider",
  "model",
  "thinkingLevel",
  "tools",
  "instructions",
  "hotkey",
  "order",
] as const satisfies readonly (keyof Preset)[];

/** Copy every declared value, including empty and omitted optional fields. */
export function cloneRpcDraft(draft: RpcPresetDraft): RpcPresetDraft {
  const preset = { ...draft.preset };

  if (preset.tools !== undefined) preset.tools = [...preset.tools];

  return { scope: draft.scope, preset };
}

/** Compare persisted values without trimming, normalizing, or sorting them. */
export function sameRpcDraft(
  first: RpcPresetDraft,
  second: RpcPresetDraft,
): boolean {
  return (
    first.scope === second.scope &&
    PRESET_FIELDS.every((field) => {
      if (
        Object.hasOwn(first.preset, field) !==
        Object.hasOwn(second.preset, field)
      ) {
        return false;
      }

      const left = first.preset[field];
      const right = second.preset[field];

      if (Array.isArray(left) && Array.isArray(right)) {
        return (
          left.length === right.length &&
          left.every((tool, index) => tool === right[index])
        );
      }

      return Object.is(left, right);
    })
  );
}

/** Check storage shape, same-scope uniqueness, trust, and shared hotkey rules. */
export function validateRpcDraft(
  draft: RpcPresetDraft,
  options: RpcDraftValidationOptions,
): RpcDraftIssue[] {
  const issues: RpcDraftIssue[] = [];

  if (draft.scope !== "user" && draft.scope !== "project") {
    issues.push({
      field: "scope",
      severity: "error",
      message: "Choose User or Project scope.",
    });
  } else if (
    options.projectTrusted === false &&
    (draft.scope === "project" || options.replaces?.scope === "project")
  ) {
    issues.push({
      field: "scope",
      severity: "error",
      message: "Trust this project before changing Project presets.",
    });
  }

  const shape = validatePresetShape(draft.preset);

  if (!shape.ok) {
    const message = shape.reason ?? "The preset shape is invalid.";
    const field = PRESET_FIELDS.find((key) => message.includes(key));

    issues.push({ field, severity: "error", message });

    return issues;
  }

  const identity = { name: draft.preset.name, scope: draft.scope };

  if (
    options.presets.some(
      (preset) =>
        samePresetIdentity(preset, identity) &&
        !samePresetIdentity(preset, options.replaces),
    )
  ) {
    issues.push({
      field: "name",
      severity: "error",
      message: `A preset named ${JSON.stringify(identity.name)} already exists in ${identity.scope === "user" ? "User" : "Project"} scope.`,
    });
  }

  const hotkey = diagnoseDraftHotkey(
    {
      ...identity,
      hotkey: draft.preset.hotkey ?? "",
      replaces: options.replaces,
    },
    options.presets,
  );

  if (hotkey) issues.push({ field: "hotkey", ...hotkey });

  return issues;
}
