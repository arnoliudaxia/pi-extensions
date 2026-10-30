/** Orchestrate preset management with standard dialogs, including RPC clients. */
import { activate } from "../../activation/activate.js";
import type { ActivePresetSession } from "../../activation/session.js";
import { EXTENSION_NAME } from "../../extension-name.js";
import type { HotkeyRegistry } from "../../hotkey-registry.js";
import {
  findPreset,
  samePresetIdentity,
  type PresetIdentity,
} from "../../preset-identity.js";
import { loadPresetsConfig, toPersistedPreset } from "../../store/api.js";
import {
  commitPresetMutation,
  type PresetMutation,
  type PresetSnapshot,
} from "../../store/mutations.js";
import type { LoadedPreset } from "../../types.js";
import {
  APPLY_LABEL,
  BACK_LABEL,
  CLEAR_ACTIVE_PRESET_LABEL,
  CLOSE_LABEL,
  DELETE_LABEL,
  DUPLICATE_LABEL,
  EDIT_LABEL,
  formatManagerAction,
  MOVE_DOWN_LABEL,
  MOVE_PRESET_TITLE,
  MOVE_UP_LABEL,
  NEW_PRESET_LABEL,
  resolveManagerAction,
  STATUS_ACTION_LABEL,
  VIEW_DETAILS_LABEL,
} from "../../ui/labels.js";
import { serializeForCopy, uniqueCopyName } from "../../ui/preset-copy.js";
import type {
  RpcDraftIssue,
  RpcEditorOptions,
  RpcPresetDraft,
} from "../../ui/rpc-editor-types.js";
import { openRpcEditor } from "../../ui/rpc-editor.js";
import { formatScopeName } from "../../ui/widgets.js";
import { runClear } from "./clear.js";
import { runStatus } from "./status.js";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describeErrorSentence } from "@sherif-fanous/pi-extensions-core";

/** Session collaborators used by the standard-dialog manager. */
export interface PresetManagerDeps {
  readonly pi: ExtensionAPI;
  readonly session: ActivePresetSession;
  readonly hotkeys: HotkeyRegistry;
}

/** The manager's closing disposition, without reusing a context after reload. */
export type PresetManagerExit =
  { readonly kind: "closed" } | { readonly kind: "reload-requested" };

/** Own one dialog loop and keep persistence outside the draft-only editor. */
class PresetManager {
  constructor(
    private readonly ctx: ExtensionCommandContext,
    private readonly deps: PresetManagerDeps,
  ) {}

  async run(selection?: PresetIdentity): Promise<void> {
    let selected = selection;

    for (;;) {
      if (selected) {
        selected = await this.presetMenu(selected);

        continue;
      }

      const { presets } = await loadPresetsConfig(this.ctx);
      const entries = new Map(
        presets.map((preset, index) => [
          `${index + 1}. ${JSON.stringify(preset.name)} · Scope: ${formatScopeName(preset.scope)}`,
          preset,
        ]),
      );
      const menuLabels = [
        NEW_PRESET_LABEL,
        ...entries.keys(),
        CLEAR_ACTIVE_PRESET_LABEL,
        STATUS_ACTION_LABEL,
        CLOSE_LABEL,
      ];
      const choice = resolveManagerAction(
        await this.ctx.ui.select(
          EXTENSION_NAME,
          menuLabels.map((label) => formatManagerAction(label)),
        ),
        menuLabels,
      );

      if (choice === undefined || choice === CLOSE_LABEL) return;

      if (choice === NEW_PRESET_LABEL) {
        selected = await this.edit("new");
      } else if (choice === CLEAR_ACTIVE_PRESET_LABEL) {
        if (
          await this.ctx.ui.confirm(
            "Clear Active Preset?",
            "Clear the active preset and restore managed settings?",
          )
        ) {
          await runClear(this.ctx, this.deps.pi, this.deps.session);
        }
      } else if (choice === STATUS_ACTION_LABEL) {
        await runStatus(this.ctx, this.deps.pi, this.deps.session);
      } else {
        selected = entries.get(choice);
      }
    }
  }

  private async apply(identity: PresetIdentity, saved = false): Promise<void> {
    try {
      const config = await loadPresetsConfig(this.ctx);
      const preset = findPreset(config.presets, identity);

      if (!preset) {
        this.ctx.ui.notify(
          saved
            ? `Preset "${identity.name}" was saved but not applied. It is no longer loaded; the saved file was not removed.`
            : `Preset "${identity.name}" is no longer loaded.`,
          "warning",
        );

        return;
      }

      const outcome = await activate(
        this.ctx,
        this.deps.pi,
        this.deps.session,
        { preset, config, trigger: "picker", policyUi: "standard" },
      );

      if (outcome.kind === "applied") return;

      const reason =
        outcome.kind === "refused"
          ? outcome.reason
          : outcome.kind === "cancelled"
            ? "Activation was cancelled or declined by the access policy."
            : "The preset is no longer available.";

      this.ctx.ui.notify(
        saved
          ? `Preset "${identity.name}" was saved but not applied. ${reason} The saved file was not removed.`
          : reason,
        saved || outcome.kind !== "refused" ? "warning" : "error",
      );
    } catch (error) {
      this.ctx.ui.notify(
        `${saved ? `Preset "${identity.name}" was saved but not applied. The saved file was not removed. ` : "Activation failed. "}${describeErrorSentence(error)}`,
        "error",
      );
    }
  }

  private async edit(
    mode: RpcEditorOptions["mode"],
    source?: LoadedPreset,
  ): Promise<PresetIdentity | undefined> {
    const { ctx, deps } = this;
    const expected = mode === "edit" && source ? snapshot(source) : undefined;
    const config = await loadPresetsConfig(ctx);
    const baseline: RpcPresetDraft = source
      ? {
          scope: source.scope,
          preset:
            mode === "duplicate"
              ? serializeForCopy(
                  source,
                  uniqueCopyName(
                    source.name,
                    config.presets
                      .filter((preset) => preset.scope === source.scope)
                      .map((preset) => preset.name),
                  ),
                  ctx.mode === "rpc",
                )
              : toPersistedPreset(source),
        }
      : {
          scope: "user",
          preset: {
            name: "",
            provider: ctx.model?.provider ?? "",
            model: ctx.model?.id ?? "",
            thinkingLevel: deps.pi.getThinkingLevel(),
          },
        };
    let initial: RpcPresetDraft | undefined;
    let issues: readonly RpcDraftIssue[] | undefined;

    for (;;) {
      const fresh = await loadPresetsConfig(ctx);
      const result = await openRpcEditor(ctx.ui, {
        mode,
        title:
          mode === "new"
            ? NEW_PRESET_LABEL
            : `${mode === "edit" ? EDIT_LABEL : DUPLICATE_LABEL} "${source?.name ?? ""}"`,
        baseline,
        ...(initial ? { initial } : {}),
        ...(expected ? { replaces: expected.identity } : {}),
        presets: fresh.presets,
        models: ctx.modelRegistry.getAll().map((model) => ({
          model,
          provider: model.provider,
          id: model.id,
          available: ctx.modelRegistry.hasConfiguredAuth(model),
        })),
        allTools: deps.pi.getAllTools().map((tool) => tool.name),
        activeTools: deps.pi.getActiveTools(),
        projectTrusted: ctx.isProjectTrusted(),
        showTerminalFields: ctx.mode === "tui",
        ...(issues ? { issues } : {}),
      });

      if (result.kind === "cancelled") return source;

      initial = result.draft;
      issues = undefined;

      if (
        expected &&
        expected.identity.scope !== result.draft.scope &&
        !(await this.confirmMove(expected.identity, result.draft.scope))
      ) {
        continue;
      }

      const mutation: PresetMutation = expected
        ? { kind: "replace", expected, ...result.draft }
        : { kind: "create", ...result.draft };
      let committed: Awaited<ReturnType<typeof commitPresetMutation>>;

      try {
        committed = await commitPresetMutation(ctx, mutation);
      } catch (error) {
        const message = `Could not save the preset. ${describeErrorSentence(error)}`;

        ctx.ui.notify(message, "error");
        issues = [{ severity: "error", message }];

        continue;
      }

      if (!committed.ok) {
        ctx.ui.notify(committed.reason, "warning");
        issues = [{ severity: "error", message: committed.reason }];

        continue;
      }

      const saved = committed.saved ?? {
        identity: { name: result.draft.preset.name, scope: result.draft.scope },
        preset: toPersistedPreset(result.draft.preset),
      };

      this.updateIdentity(expected?.identity, saved.identity);
      ctx.ui.notify(
        committed.changed
          ? `Preset "${saved.identity.name}" saved.`
          : `Preset "${saved.identity.name}" has no changes to save.`,
        "info",
      );

      if (committed.changed) {
        await this.notifyHotkeyReload(
          deps.hotkeys.saveNeedsReload(expected?.identity, {
            ...saved.preset,
            ...saved.identity,
          }),
        );
      }

      if (result.intent === "save-apply")
        await this.apply(saved.identity, true);

      return saved.identity;
    }
  }

  private async confirmMove(
    identity: PresetIdentity,
    scope: PresetIdentity["scope"],
  ): Promise<boolean> {
    return this.ctx.ui.confirm(
      MOVE_PRESET_TITLE,
      `Move preset "${identity.name}" from ${formatScopeName(identity.scope)} to ${formatScopeName(scope)} scope?`,
    );
  }

  private async notifyHotkeyReload(needsReload: boolean): Promise<void> {
    try {
      const { presets } = await loadPresetsConfig(this.ctx);
      const names = this.deps.hotkeys.changedHotkeyNames(presets);

      if (!needsReload && names.length === 0) return;

      this.ctx.ui.notify(
        `Hotkey changes${names.length ? ` for ${names.map((name) => JSON.stringify(name)).join(", ")}` : ""} need /reload to take effect. Run /reload when ready; this session was not reloaded.`,
        "warning",
      );
    } catch (error) {
      this.ctx.ui.notify(
        `Preset changes were saved, but hotkey reload status could not be checked. Run /reload when ready. ${describeErrorSentence(error)}`,
        "error",
      );
    }
  }

  private async presetMenu(
    identity: PresetIdentity,
  ): Promise<PresetIdentity | undefined> {
    const config = await loadPresetsConfig(this.ctx);
    const preset = findPreset(config.presets, identity);

    if (!preset) {
      this.ctx.ui.notify(
        `Preset "${identity.name}" is no longer loaded.`,
        "warning",
      );

      return undefined;
    }

    const destination = preset.scope === "user" ? "project" : "user";
    const moveLabel = `Move to ${formatScopeName(destination)}`;
    const actionLabels = [
      APPLY_LABEL,
      EDIT_LABEL,
      DUPLICATE_LABEL,
      moveLabel,
      MOVE_UP_LABEL,
      MOVE_DOWN_LABEL,
      VIEW_DETAILS_LABEL,
      DELETE_LABEL,
      BACK_LABEL,
    ];
    const choice = resolveManagerAction(
      await this.ctx.ui.select(
        `${JSON.stringify(preset.name)} · ${formatScopeName(preset.scope)}`,
        actionLabels.map((label) => formatManagerAction(label)),
      ),
      actionLabels,
    );

    if (choice === undefined || choice === BACK_LABEL) return undefined;

    // Resolve the exact scope again after the user has answered the menu.
    const fresh = await loadPresetsConfig(this.ctx);
    const current = findPreset(fresh.presets, identity);

    if (!current) {
      this.ctx.ui.notify(
        `Preset "${identity.name}" is no longer loaded.`,
        "warning",
      );

      return undefined;
    }

    if (choice === APPLY_LABEL) {
      await this.apply(identity);
    } else if (choice === EDIT_LABEL || choice === DUPLICATE_LABEL) {
      return this.edit(choice === EDIT_LABEL ? "edit" : "duplicate", current);
    } else if (choice === VIEW_DETAILS_LABEL) {
      await this.ctx.ui.editor(
        `Preset Details (Read Only) · ${formatScopeName(current.scope)}`,
        JSON.stringify(toPersistedPreset(current), null, 2),
      );
    } else if (choice === moveLabel) {
      if (!(await this.confirmMove(identity, destination))) return identity;

      const result = await commitPresetMutation(this.ctx, {
        kind: "replace",
        expected: snapshot(current),
        scope: destination,
        preset: toPersistedPreset(current),
      });

      if (!result.ok) {
        this.ctx.ui.notify(result.reason, "warning");

        return identity;
      }

      const saved = result.saved?.identity ?? {
        ...identity,
        scope: destination,
      };

      this.updateIdentity(identity, saved);
      this.ctx.ui.notify(
        `Preset "${saved.name}" moved to ${formatScopeName(saved.scope)} scope.`,
        "info",
      );

      if (result.changed) {
        await this.notifyHotkeyReload(
          this.deps.hotkeys.saveNeedsReload(identity, { ...current, ...saved }),
        );
      }

      return saved;
    } else if (choice === DELETE_LABEL) {
      if (
        !(await this.ctx.ui.confirm(
          `Delete "${current.name}"?`,
          `Remove preset "${current.name}" from ${formatScopeName(current.scope)} scope?`,
        ))
      ) {
        return identity;
      }

      const result = await commitPresetMutation(this.ctx, {
        kind: "delete",
        expected: snapshot(current),
      });

      if (!result.ok) {
        this.ctx.ui.notify(result.reason, "warning");

        return identity;
      }

      this.ctx.ui.notify(`Preset "${current.name}" deleted.`, "info");

      if (result.changed) {
        await this.notifyHotkeyReload(
          this.deps.hotkeys.deleteNeedsReload(identity),
        );
      }

      // Keep an active deleted preset attached so Clear can restore its baseline.
      return undefined;
    } else if (choice === MOVE_UP_LABEL || choice === MOVE_DOWN_LABEL) {
      const expectedNames = fresh.presets
        .filter((candidate) => candidate.scope === current.scope)
        .map((candidate) => candidate.name);
      const index = expectedNames.indexOf(current.name);
      const nextIndex = index + (choice === MOVE_UP_LABEL ? -1 : 1);

      if (index < 0 || nextIndex < 0 || nextIndex >= expectedNames.length) {
        this.ctx.ui.notify(
          "The preset is already at the end of its scope in that direction.",
          "info",
        );

        return identity;
      }

      const orderedNames = [...expectedNames];
      const neighbor = orderedNames[nextIndex];

      if (neighbor === undefined) return identity;

      orderedNames[index] = neighbor;
      orderedNames[nextIndex] = current.name;

      const result = await commitPresetMutation(this.ctx, {
        kind: "reorder",
        scope: current.scope,
        expectedNames,
        orderedNames,
      });

      if (!result.ok) this.ctx.ui.notify(result.reason, "warning");
      else if (result.changed) await this.notifyHotkeyReload(false);
    }

    return identity;
  }

  private updateIdentity(
    previous: PresetIdentity | undefined,
    saved: PresetIdentity,
  ): void {
    const active = this.deps.session.current();

    if (
      previous &&
      active &&
      samePresetIdentity(active, previous) &&
      !samePresetIdentity(previous, saved)
    ) {
      this.deps.session.updateIdentity(
        saved.name,
        saved.scope,
        this.ctx,
        this.deps.pi,
      );
    }
  }
}

/** Run the manager only when Pi exposes standard UI dialogs. */
export async function runPresetManager(
  ctx: ExtensionCommandContext,
  deps: PresetManagerDeps,
  options?: { selection?: PresetIdentity },
): Promise<PresetManagerExit> {
  if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
    ctx.ui.notify(
      "Preset management requires a UI with standard dialogs.",
      "warning",
    );

    return { kind: "closed" };
  }

  try {
    await new PresetManager(ctx, deps).run(options?.selection);
  } catch (error) {
    ctx.ui.notify(
      `Preset management failed. ${describeErrorSentence(error)}`,
      "error",
    );
  }

  return { kind: "closed" };
}

function snapshot(preset: LoadedPreset): PresetSnapshot {
  return {
    identity: { name: preset.name, scope: preset.scope },
    preset: toPersistedPreset(preset),
  };
}
