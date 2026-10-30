/** Share lossless draft and submission types between the RPC editor and manager. */
import type { PresetIdentity } from "../preset-identity.js";
import type { LoadedPreset, Preset, PresetScope } from "../types.js";
import type { ModelItem } from "./editor-types.js";

/** A field-level diagnostic for a draft that has not been saved. */
export interface RpcDraftIssue {
  readonly field?: keyof Preset | "scope";
  readonly severity: "error" | "warning";
  readonly message: string;
}

/** Data for one editor interaction, without storage or session capabilities. */
export interface RpcEditorOptions {
  readonly mode: "new" | "edit" | "duplicate";
  readonly title: string;
  readonly baseline: RpcPresetDraft;
  readonly initial?: RpcPresetDraft;
  readonly replaces?: PresetIdentity;
  readonly presets: readonly LoadedPreset[];
  readonly models: readonly ModelItem[];
  readonly allTools: readonly string[];
  readonly activeTools: readonly string[];
  readonly projectTrusted: boolean;
  readonly issues?: readonly RpcDraftIssue[];
  /** Terminal-only Hotkey and Order controls, hidden by default for RPC clients. */
  readonly showTerminalFields?: boolean;
}

/** Persisted preset values and the scope that will receive them. */
export interface RpcPresetDraft {
  readonly scope: PresetScope;
  readonly preset: Preset;
}

/** Submit a draft for persistence, or leave the interaction without writing. */
export type RpcEditorResult =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "submitted";
      readonly intent: "save" | "save-apply";
      readonly draft: RpcPresetDraft;
    };
