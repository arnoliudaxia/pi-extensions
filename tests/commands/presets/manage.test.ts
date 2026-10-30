/** Exercise standard-dialog management against real temporary configuration files. */
import { join } from "node:path";

import * as activation from "../../../src/activation/activate.js";
import { ActivePresetSession } from "../../../src/activation/session.js";
import * as clearCommand from "../../../src/commands/presets/clear.js";
import { runPresetManager } from "../../../src/commands/presets/manage.js";
import * as statusCommand from "../../../src/commands/presets/status.js";
import { HotkeyRegistry } from "../../../src/hotkey-registry.js";
import type { PresetIdentity } from "../../../src/preset-identity.js";
import * as store from "../../../src/store/api.js";
import * as mutations from "../../../src/store/mutations.js";
import type { Preset, PresetScope } from "../../../src/types.js";
import { formatManagerAction } from "../../../src/ui/labels.js";
import type { RpcPresetDraft } from "../../../src/ui/rpc-editor-types.js";
import * as rpcEditor from "../../../src/ui/rpc-editor.js";
import { makeStubModelRegistry } from "../../helpers/model-registry.js";
import {
  createFakeContext,
  createFakePi,
  createTempConfigDirs,
  type TempConfigDirs,
} from "../../support/index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRESET: Preset = {
  name: "Deep Work",
  provider: "anthropic",
  model: "claude",
  thinkingLevel: "high",
  tools: ["read"],
  instructions: "Keep every line.\nIncluding this one.\n",
  order: 17,
};
const IDENTITY: PresetIdentity = { name: PRESET.name, scope: "user" };
let dirs: TempConfigDirs;

function harness(steps: readonly (string | number | undefined)[] = []) {
  const answers = [...steps];
  const notify = vi.fn();
  const select = vi.fn<ReturnType<typeof createFakeContext>["ui"]["select"]>(
    (_title, options) => {
      const answer = answers.shift();

      if (answer === undefined) return Promise.resolve(undefined);

      if (typeof answer === "number") return Promise.resolve(options[answer]);

      const choice =
        options.find((option) => option === answer) ??
        (typeof answer === "string"
          ? options.find((option) => option === formatManagerAction(answer))
          : undefined);

      if (!choice)
        throw new Error(`Missing choice ${answer}: ${options.join(" | ")}`);

      return Promise.resolve(choice);
    },
  );
  const confirm = vi.fn(() => Promise.resolve(true));
  const editor = vi.fn(() => Promise.resolve("ignored changes"));
  const registry = makeStubModelRegistry({
    models: {
      anthropic: {
        claude: { hasKey: true, reasoning: true },
        locked: { hasKey: false },
        baseline: { hasKey: true, reasoning: true },
      },
    },
  });
  const models = ["claude", "locked", "baseline"].flatMap((name) => {
    const model = registry.find("anthropic", name);

    return model ? [model] : [];
  });

  registry.getAll = () => models;

  const ctx = createFakeContext({
    cwd: dirs.cwd,
    mode: "rpc",
    model: registry.find("anthropic", "baseline"),
    modelRegistry: registry,
    ui: { notify, select, confirm, editor },
  });
  const custom = vi.spyOn(ctx.ui, "custom");
  const reload = vi.spyOn(ctx, "reload");
  const setModel = vi.fn<ExtensionAPI["setModel"]>(() => Promise.resolve(true));
  const setActiveTools = vi.fn<ExtensionAPI["setActiveTools"]>();
  const setThinkingLevel = vi.fn<ExtensionAPI["setThinkingLevel"]>();
  const fake = createFakePi({
    setModel,
    setActiveTools,
    setThinkingLevel,
    getActiveTools: () => ["read", "bash"],
    getThinkingLevel: () => "low",
    getAllTools: () =>
      ["read", "bash"].map((name) => ({
        name,
        description: name,
        parameters: {},
        exposure: "direct",
        sourceInfo: {
          path: `builtin:${name}`,
          source: "builtin",
          scope: "user",
          origin: "top-level",
        },
      })),
  });
  const session = new ActivePresetSession();
  const hotkeys = new HotkeyRegistry();
  const deps = { pi: fake.pi, session, hotkeys };

  return {
    ctx,
    deps,
    fake,
    session,
    hotkeys,
    notify,
    select,
    confirm,
    editor,
    custom,
    reload,
    setModel,
    setActiveTools,
    setThinkingLevel,
  };
}

function pathFor(scope: PresetScope): string {
  return scope === "user"
    ? join(dirs.agentDir, "presets-plus", "config.json")
    : join(dirs.cwd, ".pi", "presets-plus", "config.json");
}

function submit(preset: Preset, scope: PresetScope = "user", apply = false) {
  return vi.spyOn(rpcEditor, "openRpcEditor").mockResolvedValueOnce({
    kind: "submitted",
    intent: apply ? "save-apply" : "save",
    draft: { scope, preset },
  });
}

async function writeConfig(
  presets: readonly Preset[],
  scope: PresetScope = "user",
  rules: readonly unknown[] = [],
): Promise<void> {
  await dirs.writeJson(pathFor(scope), {
    version: 2,
    presets,
    retained: { keep: true },
    ...(scope === "user" ? { policy: { rules } } : {}),
  });
}

beforeEach(async () => {
  dirs = await createTempConfigDirs();
  vi.spyOn(rpcEditor, "openRpcEditor").mockResolvedValue({ kind: "cancelled" });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await dirs.cleanup();
});

describe("preset manager dialogs", () => {
  it.each(["print", "json", "tui", "rpc"] as const)(
    "does not read configuration without a usable UI in %s mode",
    async (mode) => {
      const setup = harness();
      const load = vi.spyOn(store, "loadPresetsConfig");
      const hasUI = mode === "print" || mode === "json";

      await expect(
        runPresetManager({ ...setup.ctx, mode, hasUI }, setup.deps),
      ).resolves.toEqual({ kind: "closed" });
      expect(load).not.toHaveBeenCalled();
      expect(setup.select).not.toHaveBeenCalled();
      expect(setup.notify).toHaveBeenCalledWith(expect.any(String), "warning");
      expect(setup.custom).not.toHaveBeenCalled();
    },
  );

  it("offers creation in an empty store and closes on cancellation", async () => {
    const setup = harness();

    await runPresetManager(setup.ctx, setup.deps);

    expect(setup.select).toHaveBeenCalledExactlyOnceWith("Presets Plus", [
      "＋ New Preset",
      "↺ Clear Active Preset",
      "ⓘ Status",
      "× Close",
    ]);
    expect(setup.notify).not.toHaveBeenCalled();
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it("shows distinct scope-qualified options and the full action menu", async () => {
    await writeConfig([PRESET]);
    await writeConfig([{ ...PRESET, thinkingLevel: "low" }], "project");

    const setup = harness([2, "Back", "Close"]);

    await runPresetManager(setup.ctx, setup.deps);

    expect(setup.select.mock.calls[0]?.[1]).toEqual([
      "＋ New Preset",
      '1. "Deep Work" · Scope: User',
      '2. "Deep Work" · Scope: Project',
      "↺ Clear Active Preset",
      "ⓘ Status",
      "× Close",
    ]);

    expect(setup.select.mock.calls[1]).toEqual([
      '"Deep Work" · Project',
      [
        "▶ Apply",
        "✎ Edit",
        "⧉ Duplicate",
        "↔ Move to User",
        "↑ Move Up",
        "↓ Move Down",
        "ⓘ View Details",
        "⚠ Delete",
        "← Back",
      ],
    ]);
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it("seeds creation with inherited tools while retaining other Pi defaults and no-key models", async () => {
    const setup = harness(["New Preset"]);

    await runPresetManager(setup.ctx, setup.deps);

    expect(rpcEditor.openRpcEditor).toHaveBeenCalledWith(
      setup.ctx.ui,
      expect.objectContaining({
        mode: "new",
        baseline: {
          scope: "user",
          preset: {
            name: "",
            provider: "anthropic",
            model: "baseline",
            thinkingLevel: "low",
          },
        },
        allTools: ["read", "bash"],
        activeTools: ["read", "bash"],
        projectTrusted: true,
      }),
    );

    expect(
      vi.mocked(rpcEditor.openRpcEditor).mock.calls[0]?.[1].models,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "locked", available: false }),
      ]),
    );
    expect(await dirs.exists(pathFor("user"))).toBe(false);
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it("creates without applying, rebinding shortcuts, or reloading", async () => {
    const setup = harness(["New Preset"]);
    const bind = vi.spyOn(setup.hotkeys, "bindForSession");

    submit({ ...PRESET, hotkey: "ctrl+shift+9" });
    await runPresetManager(setup.ctx, setup.deps);

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [{ ...PRESET, hotkey: "ctrl+shift+9" }],
    });
    expect(setup.setModel).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(setup.fake.shortcuts.size).toBe(0);
    expect(setup.reload).not.toHaveBeenCalled();
    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("/reload"),
      "warning",
    );
  });

  it.each(["rpc", "tui"] as const)(
    "duplicates with mode-appropriate hotkey preservation in %s",
    async (mode) => {
      await writeConfig([
        { ...PRESET, hotkey: "ctrl+shift+9" },
        { ...PRESET, name: "Deep Work-copy" },
      ]);

      vi.mocked(rpcEditor.openRpcEditor).mockRestore();

      const setup = harness(["Duplicate", "Save"]);
      const editor = vi.spyOn(rpcEditor, "openRpcEditor");
      const copy = {
        ...PRESET,
        name: "Deep Work-copy-2",
        ...(mode === "rpc" ? { hotkey: "ctrl+shift+9" } : {}),
      };

      await runPresetManager({ ...setup.ctx, mode }, setup.deps, {
        selection: IDENTITY,
      });

      expect(editor.mock.calls[0]?.[1]).toMatchObject({
        mode: "duplicate",
        baseline: {
          scope: "user",
          preset: copy,
        },
      });

      expect(editor.mock.calls[0]?.[1].showTerminalFields).toBe(mode === "tui");
      expect(
        setup.select.mock.calls
          .flatMap(([, rows]) => rows)
          .some((row) => row.startsWith("Order: ")),
      ).toBe(mode === "tui");

      expect(
        setup.select.mock.calls
          .flatMap(([, rows]) => rows)
          .some((row) => row.startsWith("Hotkey: ")),
      ).toBe(mode === "tui");

      expect(await dirs.readJson(pathFor("user"))).toMatchObject({
        presets: [expect.anything(), expect.anything(), copy],
      });
      expect(setup.setModel).not.toHaveBeenCalled();
    },
  );

  it("preserves hidden RPC hotkey and order when editing and saving another field", async () => {
    await writeConfig([{ ...PRESET, hotkey: "ctrl+shift+9" }]);
    vi.mocked(rpcEditor.openRpcEditor).mockRestore();

    const setup = harness(["Edit", "Name: Deep Work", "Save"]);

    setup.editor.mockResolvedValueOnce("Renamed");
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(
      setup.select.mock.calls
        .flatMap(([, rows]) => rows)
        .some((row) => row.startsWith("Order: ")),
    ).toBe(false);

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [{ ...PRESET, name: "Renamed", hotkey: "ctrl+shift+9" }],
    });

    expect(
      setup.select.mock.calls
        .flatMap(([, rows]) => rows)
        .some((row) => row.startsWith("Hotkey: ")),
    ).toBe(false);
  });

  it("shows all persisted fields as read-only JSON and ignores editor output", async () => {
    await writeConfig([{ ...PRESET, hotkey: "ctrl+shift+9" }]);
    await writeConfig([PRESET], "project");

    const original = await dirs.readJson(pathFor("user"));
    const setup = harness(["View Details"]);
    const commit = vi.spyOn(mutations, "commitPresetMutation");

    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(setup.editor).toHaveBeenCalledWith(
      expect.stringContaining("Read Only"),
      JSON.stringify(
        store.toPersistedPreset({ ...PRESET, hotkey: "ctrl+shift+9" }),
        null,
        2,
      ),
    );
    expect(await dirs.readJson(pathFor("user"))).toEqual(original);
    expect(commit).not.toHaveBeenCalled();
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it("reuses status and confirms clear before reusing the clear command", async () => {
    const setup = harness([
      "Status",
      "Clear Active Preset",
      "Clear Active Preset",
      "Close",
    ]);
    const status = vi.spyOn(statusCommand, "runStatus").mockResolvedValue();
    const clear = vi.spyOn(clearCommand, "runClear").mockResolvedValue();

    setup.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await runPresetManager(setup.ctx, setup.deps);

    expect(status).toHaveBeenCalledExactlyOnceWith(
      setup.ctx,
      setup.fake.pi,
      setup.session,
    );

    expect(clear).toHaveBeenCalledExactlyOnceWith(
      setup.ctx,
      setup.fake.pi,
      setup.session,
    );
    expect(setup.confirm).toHaveBeenCalledTimes(2);
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it.each(["rpc", "tui"] as const)(
    "runs the real editor's Save And Apply flow in %s without custom UI",
    async (mode) => {
      vi.mocked(rpcEditor.openRpcEditor).mockRestore();

      const setup = harness([
        "New Preset",
        "Name: (Empty)",
        "Prompt: (Unset)",
        "Edit",
        "Save And Apply",
      ]);
      const instructions = "Persist before applying.\n完整保留\n";

      setup.editor
        .mockResolvedValueOnce("RPC Created")
        .mockResolvedValueOnce(instructions);
      await runPresetManager({ ...setup.ctx, mode }, setup.deps);

      expect(await dirs.readJson(pathFor("user"))).toMatchObject({
        presets: [
          {
            name: "RPC Created",
            provider: "anthropic",
            model: "baseline",
            thinkingLevel: "low",
            instructions,
          },
        ],
      });

      const saved = await dirs.readJson(pathFor("user"));

      expect(saved).toHaveProperty("presets.0");
      expect(saved).not.toHaveProperty("presets.0.tools");
      expect(setup.select.mock.calls[1]?.[1]).toContain(
        "Tools: Inherit (omitted)",
      );
      expect(setup.setActiveTools).not.toHaveBeenCalled();
      expect(setup.session.current()).toMatchObject({
        name: "RPC Created",
        scope: "user",
      });

      expect(
        setup.select.mock.calls
          .flatMap((call) => call[1])
          .some((option) => option.includes("Test")),
      ).toBe(false);
      expect(setup.custom).not.toHaveBeenCalled();
      expect(setup.reload).not.toHaveBeenCalled();
    },
  );

  it("persists the selected model ID rather than its RPC display name", async () => {
    vi.mocked(rpcEditor.openRpcEditor).mockRestore();

    const setup = harness([
      "New Preset",
      "Name: (Empty)",
      "Model: baseline",
      '2. "locked" (Name: "Friendly Name") (no key)',
      "Save",
    ]);
    const models = setup.ctx.modelRegistry.getAll().map((model) => ({
      ...model,
      name: "Friendly Name",
    }));

    vi.spyOn(setup.ctx.modelRegistry, "getAll").mockReturnValue(models);
    setup.editor.mockResolvedValueOnce("Named Model");
    await runPresetManager(setup.ctx, setup.deps);

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [
        { name: "Named Model", provider: "anthropic", model: "locked" },
      ],
    });
  });

  it("still lets a new preset explicitly pin the active tools", async () => {
    vi.mocked(rpcEditor.openRpcEditor).mockRestore();

    const setup = harness([
      "New Preset",
      "Name: (Empty)",
      "Tools: Inherit (omitted)",
      "Use Active Tools",
      "Save",
    ]);

    setup.editor.mockResolvedValueOnce("Pinned Tools");
    await runPresetManager(setup.ctx, setup.deps);

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [{ name: "Pinned Tools", tools: ["read", "bash"] }],
    });
    expect(setup.setActiveTools).not.toHaveBeenCalled();
  });

  it("describes dialog exceptions without opening custom UI", async () => {
    const setup = harness();

    setup.select.mockRejectedValueOnce(new Error("transport disconnected"));
    await expect(runPresetManager(setup.ctx, setup.deps)).resolves.toEqual({
      kind: "closed",
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("transport disconnected"),
      "error",
    );
    expect(setup.custom).not.toHaveBeenCalled();
  });
});

describe("preset manager mutations", () => {
  it("edits a fresh snapshot, retains neighboring external changes, and never applies", async () => {
    await writeConfig([PRESET]);

    const setup = harness(["Edit"]);
    const changed = { ...PRESET, instructions: "External before edit" };
    const saved = { ...changed, name: "Renamed", tools: [] };
    const commit = vi.spyOn(mutations, "commitPresetMutation");

    setup.select.mockImplementationOnce(async () => {
      await writeConfig([changed, { ...PRESET, name: "Neighbor" }]);

      return "Edit";
    });
    submit(saved);
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(commit.mock.calls[0]?.[1]).toEqual({
      kind: "replace",
      expected: { identity: IDENTITY, preset: changed },
      scope: "user",
      preset: saved,
    });

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      retained: { keep: true },
      presets: [saved, { ...PRESET, name: "Neighbor" }],
    });
    expect(setup.setModel).not.toHaveBeenCalled();
  });

  it("renames and moves an active identity without replacing its baseline or declaration", async () => {
    await writeConfig([PRESET]);

    const setup = harness(["Edit"]);
    const { presets } = await store.loadPresetsConfig(setup.ctx);
    const preset = presets[0];

    if (!preset) throw new Error("Missing preset");

    await activation.activate(setup.ctx, setup.fake.pi, setup.session, {
      preset,
      trigger: "picker",
    });

    const before = setup.session.current();
    const saved = { ...PRESET, name: "Moved", thinkingLevel: "low" as const };
    const update = vi.spyOn(setup.session, "updateIdentity");

    setup.setModel.mockClear();
    submit(saved, "project");
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(update).toHaveBeenCalledExactlyOnceWith(
      "Moved",
      "project",
      setup.ctx,
      setup.fake.pi,
    );

    expect(setup.session.current()).toMatchObject({
      name: "Moved",
      scope: "project",
      declared: before?.declared,
    });
    expect(setup.session.current()?.overlay).toBe(before?.overlay);
    expect(setup.setModel).not.toHaveBeenCalled();
    expect(await dirs.readJson(pathFor("user"))).toMatchObject({ presets: [] });
    expect(await dirs.readJson(pathFor("project"))).toMatchObject({
      presets: [saved],
    });
  });

  it("does not retarget a same-name active preset in the other scope", async () => {
    await writeConfig([PRESET]);
    await writeConfig([PRESET], "project");

    const setup = harness(["Edit"]);
    const { presets } = await store.loadPresetsConfig(setup.ctx);
    const project = presets.find((preset) => preset.scope === "project");

    if (!project) throw new Error("Missing project preset");

    await activation.activate(setup.ctx, setup.fake.pi, setup.session, {
      preset: project,
      trigger: "picker",
    });

    const update = vi.spyOn(setup.session, "updateIdentity");

    submit({ ...PRESET, name: "User renamed" });
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(update).not.toHaveBeenCalled();
    expect(setup.session.current()).toMatchObject({
      name: PRESET.name,
      scope: "project",
    });
  });

  it.each(["Move to Project", "Delete"])(
    "does not write after declining %s",
    async (action) => {
      await writeConfig([PRESET]);

      const setup = harness([action]);
      const commit = vi.spyOn(mutations, "commitPresetMutation");

      setup.confirm.mockResolvedValue(false);
      await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

      expect(commit).not.toHaveBeenCalled();
      expect(await dirs.readJson(pathFor("user"))).toMatchObject({
        presets: [PRESET],
      });
      expect(await dirs.exists(pathFor("project"))).toBe(false);
    },
  );

  it.each(["user", "project"] as const)(
    "moves from %s to the other scope with confirmation",
    async (scope) => {
      await writeConfig([PRESET], scope);

      const destination = scope === "user" ? "project" : "user";
      const setup = harness([
        `Move to ${destination === "user" ? "User" : "Project"}`,
      ]);

      await runPresetManager(setup.ctx, setup.deps, {
        selection: { name: PRESET.name, scope },
      });

      expect(setup.confirm).toHaveBeenCalledTimes(1);
      expect(await dirs.readJson(pathFor(scope))).toMatchObject({
        presets: [],
      });

      expect(await dirs.readJson(pathFor(destination))).toMatchObject({
        presets: [PRESET],
      });
      expect(setup.setModel).not.toHaveBeenCalled();
    },
  );

  it("keeps a deleted active preset attached and warns about live hotkeys", async () => {
    await writeConfig([{ ...PRESET, hotkey: "ctrl+shift+9" }]);

    const setup = harness(["Delete"]);
    const config = await store.loadPresetsConfig(setup.ctx);
    const preset = config.presets[0];

    if (!preset) throw new Error("Missing preset");

    setup.hotkeys.bindForSession(
      config.presets,
      setup.ctx,
      setup.fake.pi,
      setup.session,
    );

    await activation.activate(setup.ctx, setup.fake.pi, setup.session, {
      preset,
      config,
      trigger: "picker",
    });

    const active = setup.session.current();
    const deletion = vi.spyOn(setup.hotkeys, "deleteNeedsReload");

    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(setup.session.current()).toBe(active);
    expect(deletion).toHaveBeenCalledWith(IDENTITY);
    expect(await dirs.readJson(pathFor("user"))).toMatchObject({ presets: [] });
    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("/reload"),
      "warning",
    );
    expect(setup.reload).not.toHaveBeenCalled();
  });

  it("swaps only same-scope neighbors from fresh data", async () => {
    await writeConfig([PRESET, { ...PRESET, name: "Second" }]);
    await writeConfig([{ ...PRESET, name: "Project" }], "project");

    const setup = harness();
    const commit = vi.spyOn(mutations, "commitPresetMutation");

    setup.select.mockImplementationOnce(async () => {
      await writeConfig([
        PRESET,
        { ...PRESET, name: "Fresh", instructions: "new" },
        { ...PRESET, name: "Second" },
      ]);

      return "Move Down";
    });
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(commit).toHaveBeenCalledWith(setup.ctx, {
      kind: "reorder",
      scope: "user",
      expectedNames: [PRESET.name, "Fresh", "Second"],
      orderedNames: ["Fresh", PRESET.name, "Second"],
    });

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [
        { ...PRESET, name: "Fresh", instructions: "new" },
        PRESET,
        { ...PRESET, name: "Second" },
      ],
    });

    expect(await dirs.readJson(pathFor("project"))).toMatchObject({
      presets: [{ ...PRESET, name: "Project" }],
    });
  });

  it("warns when reorder changes the effective hotkey owner without rebinding", async () => {
    await writeConfig([
      { ...PRESET, hotkey: "ctrl+shift+9" },
      { ...PRESET, name: "Second", hotkey: "ctrl+shift+9" },
    ]);

    const setup = harness(["Move Down"]);
    const config = await store.loadPresetsConfig(setup.ctx);

    setup.hotkeys.bindForSession(
      config.presets,
      setup.ctx,
      setup.fake.pi,
      setup.session,
    );
    setup.notify.mockClear();

    const bind = vi.spyOn(setup.hotkeys, "bindForSession");

    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("/reload"),
      "warning",
    );
    expect(bind).not.toHaveBeenCalled();
    expect(setup.fake.shortcuts.size).toBe(1);
    expect(setup.reload).not.toHaveBeenCalled();
  });

  it("rejects stale reorder names instead of overwriting a newly added neighbor", async () => {
    await writeConfig([PRESET, { ...PRESET, name: "Second" }]);

    const setup = harness(["Move Down"]);
    const originalCommit = mutations.commitPresetMutation;

    vi.spyOn(mutations, "commitPresetMutation").mockImplementationOnce(
      async (ctx, mutation) => {
        await writeConfig([
          PRESET,
          { ...PRESET, name: "Second" },
          { ...PRESET, name: "Concurrent" },
        ]);

        return originalCommit(ctx, mutation);
      },
    );
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [
        PRESET,
        { ...PRESET, name: "Second" },
        { ...PRESET, name: "Concurrent" },
      ],
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("list changed"),
      "warning",
    );
  });

  it.each(["Move Up", "Move Down"])(
    "does not write at the boundary for %s",
    async (action) => {
      await writeConfig([PRESET]);

      const setup = harness([action]);
      const commit = vi.spyOn(mutations, "commitPresetMutation");

      await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

      expect(commit).not.toHaveBeenCalled();
    },
  );

  it("checks trust freshly when an editor is reopened and preserves the draft", async () => {
    await writeConfig([PRESET]);

    const setup = harness(["Edit"]);
    const draft: RpcPresetDraft = {
      scope: "project",
      preset: { ...PRESET, name: "Keep me", tools: [], hotkey: "ctrl+shift+9" },
    };
    let trusted = true;
    const editor = vi
      .spyOn(rpcEditor, "openRpcEditor")
      .mockImplementationOnce(() => {
        trusted = false;

        return Promise.resolve({ kind: "submitted", intent: "save", draft });
      });

    setup.ctx.isProjectTrusted = () => trusted;
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(editor.mock.calls[0]?.[1].projectTrusted).toBe(true);
    expect(editor.mock.calls[1]?.[1]).toMatchObject({
      projectTrusted: false,
      initial: draft,
      baseline: { scope: "user", preset: PRESET },
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("not trusted"),
      "warning",
    );
    expect(await dirs.exists(pathFor("project"))).toBe(false);
    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [PRESET],
    });
  });

  it("refuses a move if trust is revoked during confirmation", async () => {
    await writeConfig([PRESET]);
    await writeConfig([{ ...PRESET, name: "Untouched" }], "project");

    const original = await dirs.readJson(pathFor("project"));
    const setup = harness(["Move to Project"]);

    setup.confirm.mockImplementationOnce(() => {
      setup.ctx.isProjectTrusted = () => false;

      return Promise.resolve(true);
    });
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(await dirs.readJson(pathFor("project"))).toEqual(original);
    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [PRESET],
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("not trusted"),
      "warning",
    );
  });

  it("preserves every draft field and original baseline across expected and thrown save failures", async () => {
    await writeConfig([PRESET]);

    const setup = harness(["Edit"]);
    const draft: RpcPresetDraft = {
      scope: "user",
      preset: {
        ...PRESET,
        name: "Renamed",
        hotkey: "ctrl+shift+9",
        instructions: "\nUnicode 保留\n",
        tools: [],
        order: -7,
      },
    };
    const editor = vi
      .spyOn(rpcEditor, "openRpcEditor")
      .mockResolvedValueOnce({ kind: "submitted", intent: "save", draft })
      .mockResolvedValueOnce({ kind: "submitted", intent: "save", draft })
      .mockResolvedValueOnce({ kind: "submitted", intent: "save", draft });
    const commit = vi
      .spyOn(mutations, "commitPresetMutation")
      .mockResolvedValueOnce({
        ok: false,
        code: "collision",
        reason: "Please choose another name.",
      })
      .mockRejectedValueOnce(new Error("disk unavailable"));

    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(editor).toHaveBeenCalledTimes(3);
    expect(editor.mock.calls[1]?.[1]).toMatchObject({
      initial: draft,
      baseline: { scope: "user", preset: PRESET },
      issues: [{ severity: "error", message: "Please choose another name." }],
    });

    expect(editor.mock.calls[2]?.[1]).toMatchObject({
      initial: draft,
      baseline: { scope: "user", preset: PRESET },
    });

    expect(editor.mock.calls[2]?.[1].issues?.[0]?.message).toContain(
      "disk unavailable",
    );

    expect(editor.mock.calls[2]?.[1].baseline).toBe(
      editor.mock.calls[0]?.[1].baseline,
    );

    expect(commit.mock.calls.map((call) => call[1])).toEqual(
      Array.from({ length: 3 }, () => ({
        kind: "replace",
        expected: { identity: IDENTITY, preset: PRESET },
        ...draft,
      })),
    );

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [draft.preset],
    });
  });

  it("never overwrites stale edited data and leaves the original snapshot fixed on retry", async () => {
    await writeConfig([PRESET]);

    const setup = harness(["Edit"]);
    const external = { ...PRESET, instructions: "External concurrent edit" };
    const draft = {
      scope: "user" as const,
      preset: { ...PRESET, name: "Mine" },
    };
    const editor = vi
      .spyOn(rpcEditor, "openRpcEditor")
      .mockImplementationOnce(async () => {
        await writeConfig([external]);

        return { kind: "submitted", intent: "save", draft };
      });

    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(editor.mock.calls[1]?.[1]).toMatchObject({
      initial: draft,
      baseline: { scope: "user", preset: PRESET },
    });

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [external],
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("changed or was deleted"),
      "warning",
    );
  });

  it.each(["Delete", "Move to Project"])(
    "refuses %s after a concurrent change during confirmation",
    async (action) => {
      await writeConfig([PRESET]);

      const setup = harness([action]);
      const external = { ...PRESET, instructions: "Changed while confirming" };

      setup.confirm.mockImplementationOnce(async () => {
        await writeConfig([external]);

        return true;
      });
      await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

      expect(await dirs.readJson(pathFor("user"))).toMatchObject({
        presets: [external],
      });
      expect(await dirs.exists(pathFor("project"))).toBe(false);
      expect(setup.notify).toHaveBeenCalledWith(
        expect.stringContaining("changed or was deleted"),
        "warning",
      );
    },
  );

  it("does not replace a colliding destination during a move", async () => {
    await writeConfig([PRESET]);
    await writeConfig(
      [{ ...PRESET, instructions: "Keep destination" }],
      "project",
    );

    const setup = harness(["Move to Project"]);
    const original = await dirs.readJson(pathFor("project"));

    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(await dirs.readJson(pathFor("project"))).toEqual(original);
    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [PRESET],
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
      "warning",
    );
  });

  it("updates a standalone moved active identity without reapplying", async () => {
    await writeConfig([PRESET]);

    const setup = harness(["Move to Project"]);

    await activation.activate(setup.ctx, setup.fake.pi, setup.session, {
      name: PRESET.name,
      scope: "user",
      trigger: "picker",
    });

    const active = setup.session.current();

    setup.setModel.mockClear();
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(setup.session.current()).toMatchObject({
      name: PRESET.name,
      scope: "project",
      declared: active?.declared,
    });
    expect(setup.session.current()?.overlay).toBe(active?.overlay);
    expect(setup.setModel).not.toHaveBeenCalled();
  });

  it("does not save or retarget when an unchanged edit is submitted", async () => {
    await writeConfig([PRESET]);

    const setup = harness(["Edit"]);
    const save = vi.spyOn(store, "updatePreset");
    const reloadCheck = vi.spyOn(setup.hotkeys, "saveNeedsReload");

    submit(PRESET);
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(save).not.toHaveBeenCalled();
    expect(reloadCheck).not.toHaveBeenCalled();
    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("no changes"),
      "info",
    );
  });

  it("refuses an unsafe file and preserves the draft without writing", async () => {
    await dirs.writeJson(pathFor("user"), { version: 999, presets: [PRESET] });

    const original = await dirs.readJson(pathFor("user"));
    const setup = harness(["New Preset"]);
    const editor = submit(PRESET);

    await runPresetManager(setup.ctx, setup.deps);

    expect(await dirs.readJson(pathFor("user"))).toEqual(original);
    expect(editor.mock.calls[1]?.[1].initial).toEqual({
      scope: "user",
      preset: PRESET,
    });
    expect(setup.notify).toHaveBeenCalledWith(expect.any(String), "warning");
  });

  it("preserves the draft when an edited scope move confirmation is cancelled", async () => {
    await writeConfig([PRESET]);

    const setup = harness(["Edit"]);
    const editor = submit({ ...PRESET, name: "Draft rename" }, "project");
    const commit = vi.spyOn(mutations, "commitPresetMutation");

    setup.confirm.mockResolvedValueOnce(false);
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(editor.mock.calls[1]?.[1].initial).toEqual({
      scope: "project",
      preset: { ...PRESET, name: "Draft rename" },
    });
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("preset manager activation", () => {
  it.each(["user", "project"] as const)(
    "applies the exact %s selection through shared activation",
    async (scope) => {
      await writeConfig([PRESET]);
      await writeConfig([{ ...PRESET, thinkingLevel: "low" }], "project");

      const setup = harness(["Apply"]);
      const activate = vi.spyOn(activation, "activate");

      await runPresetManager(setup.ctx, setup.deps, {
        selection: { name: PRESET.name, scope },
      });

      const request = activate.mock.calls[0]?.[3];

      expect(request).toMatchObject({
        trigger: "picker",
        preset: { name: PRESET.name, scope },
      });

      expect(
        request && "preset" in request
          ? request.config?.presets.includes(request.preset)
          : false,
      ).toBe(true);

      expect(setup.session.current()).toMatchObject({
        name: PRESET.name,
        scope,
      });
      expect(setup.custom).not.toHaveBeenCalled();
    },
  );

  it("uses fresh values when Apply is chosen after an external edit", async () => {
    await writeConfig([PRESET]);

    const setup = harness();
    const activate = vi.spyOn(activation, "activate");

    setup.select.mockImplementationOnce(async () => {
      await writeConfig([{ ...PRESET, thinkingLevel: "minimal" }]);

      return "Apply";
    });
    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(activate.mock.calls[0]?.[3]).toMatchObject({
      preset: { ...PRESET, thinkingLevel: "minimal", scope: "user" },
      policyUi: "standard",
    });
    expect(setup.setThinkingLevel).toHaveBeenCalledWith("minimal");
  });

  it("reports an ordinary unavailable Apply without custom UI", async () => {
    await writeConfig([{ ...PRESET, model: "locked" }]);

    const setup = harness(["Apply"]);

    await runPresetManager(setup.ctx, setup.deps, { selection: IDENTITY });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("no API key"),
      "error",
    );
    expect(setup.setModel).not.toHaveBeenCalled();
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it("uses newly loaded policy after committing Save And Apply", async () => {
    const setup = harness(["New Preset"]);
    const originalCommit = mutations.commitPresetMutation;

    vi.spyOn(mutations, "commitPresetMutation").mockImplementationOnce(
      async (ctx, mutation) => {
        const result = await originalCommit(ctx, mutation);

        await writeConfig([PRESET], "user", [
          { match: ".", prohibit: [{ pattern: "^Deep Work$" }] },
        ]);

        return result;
      },
    );
    setup.confirm.mockResolvedValueOnce(false);
    submit(PRESET, "user", true);
    await runPresetManager(setup.ctx, setup.deps);

    expect(setup.confirm).toHaveBeenCalledWith(
      "Preset Doesn't Match Policy",
      expect.any(String),
    );
    expect(setup.setModel).not.toHaveBeenCalled();
    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("saved but not applied"),
      "warning",
    );

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [PRESET],
    });
  });

  it("continues Save And Apply if only the hotkey reload check fails", async () => {
    const setup = harness(["New Preset"]);

    vi.spyOn(setup.hotkeys, "changedHotkeyNames").mockImplementationOnce(() => {
      throw new Error("hotkey check failed");
    });
    submit(PRESET, "user", true);
    await runPresetManager(setup.ctx, setup.deps);

    expect(setup.session.current()).toMatchObject(IDENTITY);
    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("hotkey check failed"),
      "error",
    );

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [PRESET],
    });
  });

  it("saves before loading the exact identity and applying persisted instructions", async () => {
    await writeConfig(
      [{ ...PRESET, instructions: "Project shadow" }],
      "project",
    );

    const setup = harness(["New Preset"]);
    const activate = vi.spyOn(activation, "activate");

    submit(PRESET, "user", true);
    await runPresetManager(setup.ctx, setup.deps);

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [PRESET],
    });

    expect(activate.mock.calls[0]?.[3]).toMatchObject({
      preset: { ...PRESET, scope: "user", shadowed: true },
      trigger: "picker",
    });

    expect(setup.session.current()).toMatchObject({
      name: PRESET.name,
      scope: "user",
    });
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it.each(["rpc", "tui"] as const)(
    "keeps a saved file after policy decline in %s without custom UI",
    async (mode) => {
      await writeConfig([], "user", [
        { match: ".", prohibit: [{ pattern: "^Deep Work$" }] },
      ]);

      const setup = harness(["New Preset"]);

      setup.confirm.mockResolvedValue(false);
      submit(PRESET, "user", true);
      await runPresetManager({ ...setup.ctx, mode }, setup.deps);

      expect(await dirs.readJson(pathFor("user"))).toMatchObject({
        presets: [PRESET],
      });

      expect(setup.confirm).toHaveBeenCalledWith(
        "Preset Doesn't Match Policy",
        expect.any(String),
      );

      expect(setup.notify).toHaveBeenCalledWith(
        expect.stringContaining("saved but not applied"),
        "warning",
      );
      expect(setup.setModel).not.toHaveBeenCalled();
      expect(setup.custom).not.toHaveBeenCalled();
    },
  );

  it("keeps a saved unavailable preset and explicitly reports saved-not-applied", async () => {
    const setup = harness(["New Preset"]);
    const saved = { ...PRESET, model: "locked" };

    submit(saved, "user", true);
    await runPresetManager(setup.ctx, setup.deps);

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [saved],
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("saved but not applied"),
      "warning",
    );
    expect(setup.setModel).not.toHaveBeenCalled();
    expect(setup.session.current()).toBeUndefined();
  });

  it("does not apply if the save failed and the user cancels the preserved draft", async () => {
    const setup = harness(["New Preset"]);
    const activate = vi.spyOn(activation, "activate");

    submit(PRESET, "user", true);
    vi.spyOn(mutations, "commitPresetMutation").mockResolvedValueOnce({
      ok: false,
      code: "unsafe",
      reason: "Unsafe file.",
    });
    await runPresetManager(setup.ctx, setup.deps);

    expect(activate).not.toHaveBeenCalled();
    expect(await dirs.exists(pathFor("user"))).toBe(false);
  });

  it("reports activation exceptions as saved-not-applied rather than reopening the editor", async () => {
    const setup = harness(["New Preset"]);

    submit(PRESET, "user", true);
    setup.setModel.mockRejectedValueOnce(new Error("model transport failed"));
    await runPresetManager(setup.ctx, setup.deps);

    expect(await dirs.readJson(pathFor("user"))).toMatchObject({
      presets: [PRESET],
    });
    expect(rpcEditor.openRpcEditor).toHaveBeenCalledTimes(1);
    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("saved but not applied"),
      "error",
    );

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("model transport failed"),
      "error",
    );
  });
});
