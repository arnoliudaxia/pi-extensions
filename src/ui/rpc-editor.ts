/** Edit every persisted preset field through standard, RPC-compatible dialogs. */
import { THINKING_LEVELS, type Preset } from "../types.js";
import { availableProviders } from "./editor/providers.js";
import {
  cloneRpcDraft,
  sameRpcDraft,
  validateRpcDraft,
} from "./editor/rpc-draft.js";
import { buildRpcMenu } from "./editor/rpc-menu.js";
import {
  BACK_LABEL,
  CANCEL_LABEL,
  CLEAR_LABEL,
  EDIT_LABEL,
  MODEL_LABEL,
  PROMPT_EDITOR_TITLE,
  SCOPE_LABEL,
  THINKING_LABEL,
  TOOLS_LABEL,
} from "./labels.js";
import type {
  RpcDraftIssue,
  RpcEditorOptions,
  RpcEditorResult,
  RpcPresetDraft,
} from "./rpc-editor-types.js";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

type RpcUI = Pick<
  ExtensionUIContext,
  "select" | "input" | "editor" | "confirm" | "notify"
>;

const NAME_LABEL = "Name";
const PROVIDER_LABEL = "Provider";
const PROMPT_LABEL = "Prompt";
const HOTKEY_LABEL = "Hotkey";
const INHERIT_LABEL = "Inherit";
const DEFAULT_THINKING_LABEL = "Default (Off)";
const MANUAL_LABEL = "Enter ID Manually";
const DONE_LABEL = "Done";
const ADD_TOOL_LABEL = "Add Tool";
const PRESET_TOOLS_LABEL = "Use Preset Tools";
const ACTIVE_TOOLS_LABEL = "Use Active Tools";

/** Submit a lossless draft for the caller to save, without applying or writing it. */
export async function openRpcEditor(
  ui: RpcUI,
  options: RpcEditorOptions,
): Promise<RpcEditorResult> {
  const baseline = cloneRpcDraft(options.baseline);
  let draft = cloneRpcDraft(options.initial ?? options.baseline);

  showIssues(ui, options.issues ?? []);

  for (;;) {
    const menu = buildRpcMenu(draft, options.showTerminalFields);
    const selected = await ui.select(options.title, [...menu.keys()]);
    const choice = selected === undefined ? undefined : menu.get(selected);

    if (selected === undefined || choice === "cancel") {
      if (
        sameRpcDraft(draft, baseline) ||
        (await ui.confirm(
          "Discard Changes?",
          "Discard the unsaved changes to this preset?",
        ))
      ) {
        return { kind: "cancelled" };
      }

      continue;
    }

    if (choice === "save" || choice === "save-apply") {
      const issues = validateRpcDraft(draft, options);

      showIssues(ui, issues);

      if (issues.some((issue) => issue.severity === "error")) continue;

      showAvailability(ui, draft, options);

      return {
        kind: "submitted",
        intent: choice,
        draft: cloneRpcDraft(draft),
      };
    }

    if (choice === "provider" || choice === "model") {
      const field = choice;
      const value = await selectId(ui, field, draft, options);

      if (value !== undefined) draft = withField(draft, field, value);

      continue;
    }

    if (choice === "instructions" || choice === "hotkey") {
      const field = choice;
      const action = await ui.select(
        field === "instructions" ? PROMPT_LABEL : HOTKEY_LABEL,
        [EDIT_LABEL, CLEAR_LABEL, BACK_LABEL],
      );

      if (action === CLEAR_LABEL) {
        draft = withField(draft, field, undefined);
      } else if (action === EDIT_LABEL) {
        const prefill = draft.preset[field] ?? "";
        const value =
          field === "instructions"
            ? await ui.editor(PROMPT_EDITOR_TITLE, prefill)
            : await editSingleLine(ui, HOTKEY_LABEL, prefill);

        if (value !== undefined) draft = withField(draft, field, value);
      }

      continue;
    }

    switch (choice) {
      case "name": {
        const value = await editSingleLine(ui, NAME_LABEL, draft.preset.name);

        if (value !== undefined) draft = withField(draft, "name", value);

        break;
      }

      case "scope": {
        const scope = await ui.select(
          `${SCOPE_LABEL} (Current: ${draft.scope === "user" ? "User" : "Project"})`,
          ["User", "Project"],
        );

        if (scope === "User" || scope === "Project") {
          draft = { ...draft, scope: scope === "User" ? "user" : "project" };

          if (scope === "Project" && !options.projectTrusted) {
            ui.notify(
              "Trust this project before saving Project presets.",
              "warning",
            );
          }
        }

        break;
      }

      case "thinkingLevel": {
        const level = await ui.select(
          `${THINKING_LABEL} (Current: ${draft.preset.thinkingLevel ?? DEFAULT_THINKING_LABEL})`,
          [DEFAULT_THINKING_LABEL, ...THINKING_LEVELS],
        );

        if (level === DEFAULT_THINKING_LABEL) {
          draft = withField(draft, "thinkingLevel", undefined);
        } else {
          const thinking = THINKING_LEVELS.find((item) => item === level);

          if (thinking !== undefined) {
            draft = withField(draft, "thinkingLevel", thinking);
          }
        }

        break;
      }

      case "tools":
        draft = await editTools(ui, draft, options);

        break;
      case "order":
        draft = await editOrder(ui, draft);

        break;
    }
  }
}

async function editOrder(
  ui: RpcUI,
  draft: RpcPresetDraft,
): Promise<RpcPresetDraft> {
  let prefill = draft.preset.order?.toString() ?? "";

  for (;;) {
    const value = await editSingleLine(ui, "Order (Empty Clears)", prefill);

    if (value === undefined) return draft;
    if (value.trim().length === 0) return withField(draft, "order", undefined);

    const order = Number(value);

    if (Number.isFinite(order)) return withField(draft, "order", order);

    ui.notify(
      "Order must be a finite number. Leave it empty to clear it.",
      "warning",
    );
    prefill = value;
  }
}

async function editSingleLine(
  ui: RpcUI,
  title: string,
  current: string,
): Promise<string | undefined> {
  let prefill = current;

  for (;;) {
    const value = await ui.editor(title, prefill);

    if (value === undefined || !/[\r\n\u2028\u2029]/u.test(value)) return value;

    ui.notify(
      "Enter a single line, or cancel to keep the current value.",
      "warning",
    );
    prefill = value;
  }
}

async function editTools(
  ui: RpcUI,
  draft: RpcPresetDraft,
  options: RpcEditorOptions,
): Promise<RpcPresetDraft> {
  let selected =
    draft.preset.tools === undefined ? undefined : [...draft.preset.tools];

  for (;;) {
    const tools = [
      ...new Set([
        ...options.allTools,
        ...options.activeTools,
        ...(draft.preset.tools ?? []),
        ...(selected ?? []),
      ]),
    ];
    const toggles = tools.map(
      (tool, index) =>
        `${index + 1}. [${selected?.includes(tool) ? "x" : " "}] ${JSON.stringify(tool)}`,
    );
    const choice = await ui.select(
      `${TOOLS_LABEL} (Current: ${selected === undefined ? INHERIT_LABEL : JSON.stringify(selected)})`,
      [
        INHERIT_LABEL,
        PRESET_TOOLS_LABEL,
        ACTIVE_TOOLS_LABEL,
        CLEAR_LABEL,
        ...toggles,
        ADD_TOOL_LABEL,
        DONE_LABEL,
        CANCEL_LABEL,
      ],
    );

    if (choice === undefined || choice === CANCEL_LABEL) return draft;
    if (choice === INHERIT_LABEL) return withField(draft, "tools", undefined);
    if (choice === CLEAR_LABEL) return withField(draft, "tools", []);
    if (choice === ACTIVE_TOOLS_LABEL)
      return withField(draft, "tools", [...options.activeTools]);
    if (choice === DONE_LABEL) return withField(draft, "tools", selected);

    if (choice === PRESET_TOOLS_LABEL) {
      selected ??= [];
    } else if (choice === ADD_TOOL_LABEL) {
      const tool = await editSingleLine(ui, ADD_TOOL_LABEL, "");

      if (tool === undefined) continue;

      if (tool.length === 0) {
        ui.notify(
          "Enter a non-empty tool name, or cancel to keep the current tools.",
          "warning",
        );
      } else if (!selected?.includes(tool)) {
        selected = [...(selected ?? []), tool];
      }
    } else {
      const index = toggles.indexOf(choice);
      const tool = index < 0 ? undefined : tools[index];

      if (tool !== undefined) {
        selected = selected?.includes(tool)
          ? selected.filter((item) => item !== tool)
          : [...(selected ?? []), tool];
      }
    }
  }
}

async function selectId(
  ui: RpcUI,
  field: "provider" | "model",
  draft: RpcPresetDraft,
  options: RpcEditorOptions,
): Promise<string | undefined> {
  const label = field === "provider" ? PROVIDER_LABEL : MODEL_LABEL;
  const models = options.models.filter(
    (model) => model.provider === draft.preset.provider,
  );
  const ids =
    field === "provider"
      ? availableProviders(options.models)
      : models.map((model) => model.id);
  const rows = ids.map((id, index) => {
    const name = field === "model" ? models[index]?.model.name : undefined;
    const displayName = name?.trim() ? ` (Name: ${JSON.stringify(name)})` : "";
    const suffix =
      field === "model" && !models[index]?.available ? " (no key)" : "";

    return `${index + 1}. ${JSON.stringify(id)}${displayName}${suffix}`;
  });
  const choice = await ui.select(
    `${label} (Current: ${JSON.stringify(draft.preset[field])})`,
    [...rows, MANUAL_LABEL, CANCEL_LABEL],
  );

  if (choice === MANUAL_LABEL) {
    return editSingleLine(ui, label, draft.preset[field]);
  }

  const index = choice === undefined ? -1 : rows.indexOf(choice);

  return index < 0 ? undefined : ids[index];
}

function showAvailability(
  ui: RpcUI,
  draft: RpcPresetDraft,
  options: RpcEditorOptions,
): void {
  const model = options.models.find(
    (item) =>
      item.provider === draft.preset.provider && item.id === draft.preset.model,
  );

  if (!model) {
    ui.notify(
      "This model is not registered. The preset can still be saved.",
      "warning",
    );
  } else if (!model.available) {
    ui.notify(
      "This model has no API key configured. The preset can still be saved.",
      "warning",
    );
  }
}

function showIssues(ui: RpcUI, issues: readonly RpcDraftIssue[]): void {
  if (issues.length === 0) return;

  ui.notify(
    issues
      .map(
        (issue) => `${issue.field ? `${issue.field}: ` : ""}${issue.message}`,
      )
      .join("\n"),
    "warning",
  );
}

function withField<Key extends keyof Preset>(
  draft: RpcPresetDraft,
  field: Key,
  value: Preset[Key] | undefined,
): RpcPresetDraft {
  const preset = { ...draft.preset };

  if (value === undefined) {
    delete preset[field];
  } else {
    preset[field] = value;
  }

  return { ...draft, preset };
}
