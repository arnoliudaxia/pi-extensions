/** Exercise the standard-dialog RPC editor without storage or session capabilities. */
import type { Preset } from "../../src/types.js";
import type { ModelItem } from "../../src/ui/editor-types.js";
import { THINKING_LABEL } from "../../src/ui/labels.js";
import type {
  RpcEditorOptions,
  RpcPresetDraft,
} from "../../src/ui/rpc-editor-types.js";
import { openRpcEditor } from "../../src/ui/rpc-editor.js";
import { createFakeContext } from "../support/index.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

type Step =
  | { kind: "select"; value: string | RegExp | number | undefined }
  | { kind: "editor"; value: string | undefined; prefill?: string }
  | { kind: "confirm"; value: boolean };

const PRESET: Preset = {
  name: "  Original  ",
  provider: "manual-provider",
  model: "unknown-model",
  thinkingLevel: "off",
  tools: ["unknown", "read"],
  instructions: " \n  Keep all whitespace.\t\n\n",
  hotkey: " Shift+Ctrl+1 ",
  order: 0,
};
const BASELINE: RpcPresetDraft = { scope: "user", preset: PRESET };
const MODELS: ModelItem[] = [
  {
    provider: "registered",
    id: "no-key-model",
    available: false,
    model: { reasoning: false } as Model<Api>,
  },
  {
    provider: "registered",
    id: "available-model",
    available: true,
    model: { reasoning: true } as Model<Api>,
  },
  {
    provider: "no-key-provider",
    id: "another-model",
    available: false,
    model: { reasoning: true } as Model<Api>,
  },
];

function editor(value?: string, prefill?: string): Step {
  return { kind: "editor", value, prefill };
}

function harness(steps: Step[], overrides: Partial<RpcEditorOptions> = {}) {
  const pending = [...steps];
  const notify = vi.fn();
  const selectDialog = vi.fn((_title: string, rows: string[]) => {
    const step = pending.shift();

    if (step?.kind !== "select")
      throw new Error(`Expected select step, got ${JSON.stringify(step)}.`);

    const value = step.value;
    const choice =
      typeof value === "number"
        ? rows[value]
        : value instanceof RegExp
          ? rows.find((row) => value.test(row))
          : value;

    if (value !== undefined) expect(rows).toContain(choice);

    return Promise.resolve(choice);
  });
  const editorDialog = vi.fn((_title: string, prefill?: string) => {
    const step = pending.shift();

    if (step?.kind !== "editor")
      throw new Error(`Expected editor step, got ${JSON.stringify(step)}.`);
    if (step.prefill !== undefined) expect(prefill).toBe(step.prefill);

    return Promise.resolve(step.value);
  });
  const confirm = vi.fn(() => {
    const step = pending.shift();

    if (step?.kind !== "confirm")
      throw new Error(`Expected confirm step, got ${JSON.stringify(step)}.`);

    return Promise.resolve(step.value);
  });
  const ctx = createFakeContext({
    mode: "rpc",
    ui: { select: selectDialog, editor: editorDialog, confirm, notify },
  });
  const custom = vi.spyOn(ctx.ui, "custom");
  const input = vi.spyOn(ctx.ui, "input");
  const options: RpcEditorOptions = {
    mode: "edit",
    title: "Edit Preset",
    baseline: BASELINE,
    presets: [],
    models: [],
    allTools: ["read", "bash"],
    activeTools: ["bash"],
    projectTrusted: true,
    ...overrides,
  };

  return {
    ui: ctx.ui,
    options,
    notify,
    select: selectDialog,
    editor: editorDialog,
    confirm,
    finished() {
      expect(pending).toEqual([]);
      expect(custom).not.toHaveBeenCalled();
      expect(input).not.toHaveBeenCalled();
    },
  };
}

function select(value?: string | RegExp | number): Step {
  return { kind: "select", value };
}

describe("openRpcEditor", () => {
  it.each(["Save", "Save And Apply"])(
    "round-trips every persisted field without loss on %s",
    async (action) => {
      const setup = harness([select(action)]);
      const result = await openRpcEditor(setup.ui, setup.options);

      expect(result).toStrictEqual({
        kind: "submitted",
        intent: action === "Save" ? "save" : "save-apply",
        draft: BASELINE,
      });

      if (result.kind !== "submitted") throw new Error("Expected submission.");

      expect(result.draft).not.toBe(BASELINE);
      expect(result.draft.preset).not.toBe(PRESET);
      expect(result.draft.preset.tools).not.toBe(PRESET.tools);
      expect(setup.select.mock.calls[0]?.[1]).toEqual([
        "Name",
        "Scope",
        "Provider",
        "Model",
        THINKING_LABEL,
        "Tools",
        "Prompt",
        "Hotkey",
        "Order",
        "Save",
        "Save And Apply",
        "Cancel",
      ]);

      expect(setup.notify).toHaveBeenCalledWith(
        expect.stringContaining("not registered"),
        "warning",
      );
      setup.finished();
    },
  );

  it("round-trips omitted optional fields without introducing defaults", async () => {
    const baseline: RpcPresetDraft = {
      scope: "project",
      preset: { name: "minimal", provider: "p", model: "m" },
    };
    const setup = harness([select("Save")], { baseline });

    expect(await openRpcEditor(setup.ui, setup.options)).toStrictEqual({
      kind: "submitted",
      intent: "save",
      draft: baseline,
    });
    setup.finished();
  });

  it("edits all fields, including manual provider and model IDs with an empty registry", async () => {
    const setup = harness([
      select("Name"),
      editor("  Renamed  ", PRESET.name),
      select("Scope"),
      select("Project"),
      select("Provider"),
      select("Enter ID Manually"),
      editor("custom-provider", PRESET.provider),
      select("Model"),
      select("Enter ID Manually"),
      editor("custom-model", PRESET.model),
      select(THINKING_LABEL),
      select("max"),
      select("Tools"),
      select(/\[ \] "bash"/),
      select("Add Tool"),
      editor("custom-tool", ""),
      select("Done"),
      select("Prompt"),
      select("Edit"),
      editor(" \n new prompt \t\n\n", PRESET.instructions),
      select("Hotkey"),
      select("Edit"),
      editor(" Ctrl+Shift+2 ", PRESET.hotkey),
      select("Order"),
      editor("-2.5", "0"),
      select("Save And Apply"),
    ]);

    expect(await openRpcEditor(setup.ui, setup.options)).toStrictEqual({
      kind: "submitted",
      intent: "save-apply",
      draft: {
        scope: "project",
        preset: {
          name: "  Renamed  ",
          provider: "custom-provider",
          model: "custom-model",
          thinkingLevel: "max",
          tools: ["unknown", "read", "bash", "custom-tool"],
          instructions: " \n new prompt \t\n\n",
          hotkey: " Ctrl+Shift+2 ",
          order: -2.5,
        },
      },
    });
    expect(BASELINE.preset).toStrictEqual(PRESET);
    expect(PRESET.tools).toEqual(["unknown", "read"]);
    setup.finished();
  });

  it("offers no-key registry entries and never snaps thinking or resets other fields", async () => {
    const setup = harness(
      [
        select("Provider"),
        select(/"no-key-provider".*no key/),
        select("Model"),
        select(/"another-model".*no key/),
        select("Save"),
      ],
      {
        models: MODELS,
        baseline: { ...BASELINE, preset: { ...PRESET, thinkingLevel: "max" } },
      },
    );

    expect(await openRpcEditor(setup.ui, setup.options)).toStrictEqual({
      kind: "submitted",
      intent: "save",
      draft: {
        scope: "user",
        preset: {
          ...PRESET,
          provider: "no-key-provider",
          model: "another-model",
          thinkingLevel: "max",
        },
      },
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("no API key"),
      "warning",
    );
    setup.finished();
  });

  it("labels omitted thinking as Default (Off), distinct from explicit off", async () => {
    const setup = harness([
      select(THINKING_LABEL),
      select("Default (Off)"),
      select("Save"),
    ]);
    const result = await openRpcEditor(setup.ui, setup.options);

    expect(result.kind).toBe("submitted");

    if (result.kind !== "submitted") throw new Error("Expected submission.");

    expect(result.draft.preset).not.toHaveProperty("thinkingLevel");
    setup.finished();

    const second = harness(
      [select(THINKING_LABEL), select("off"), select("Save")],
      { baseline: result.draft },
    );

    expect(await openRpcEditor(second.ui, second.options)).toMatchObject({
      draft: { preset: { thinkingLevel: "off" } },
    });

    expect(second.select.mock.calls[1]).toEqual([
      `${THINKING_LABEL} (Current: Default (Off))`,
      [
        "Default (Off)",
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
    ]);
    expect(second.select.mock.calls[1]?.[1]).not.toContain("Inherit");
    second.finished();
  });

  it.each([
    ["Inherit", undefined],
    ["Clear", []],
    ["Use Active Tools", ["bash"]],
  ] as const)(
    "selects tools mode %s without conflating omitted and empty",
    async (action, expected) => {
      const setup = harness([select("Tools"), select(action), select("Save")]);
      const result = await openRpcEditor(setup.ui, setup.options);

      if (result.kind !== "submitted") throw new Error("Expected submission.");

      expect(result.draft.preset.tools).toEqual(expected);

      if (expected === undefined)
        expect(result.draft.preset).not.toHaveProperty("tools");

      setup.finished();
    },
  );

  it("can pin an empty tool selection and toggle unknown tools without dropping others", async () => {
    const setup = harness([
      select("Tools"),
      select(/\[x\] "unknown"/),
      select("Done"),
      select("Save"),
    ]);

    expect(await openRpcEditor(setup.ui, setup.options)).toMatchObject({
      draft: { preset: { tools: ["read"] } },
    });
    setup.finished();

    const minimal = {
      scope: "user",
      preset: { name: "n", provider: "p", model: "m" },
    } as const;
    const second = harness(
      [
        select("Tools"),
        select("Use Preset Tools"),
        select("Done"),
        select("Save"),
      ],
      { baseline: minimal },
    );

    expect(await openRpcEditor(second.ui, second.options)).toMatchObject({
      draft: { preset: { tools: [] } },
    });
    second.finished();
  });

  it("keeps unknown tools available to toggle back on after deselection", async () => {
    const setup = harness([
      select("Tools"),
      select(/\[x\] "unknown"/),
      select(/\[ \] "unknown"/),
      select("Done"),
      select("Save"),
    ]);

    expect(await openRpcEditor(setup.ui, setup.options)).toMatchObject({
      draft: { preset: { tools: ["read", "unknown"] } },
    });
    setup.finished();
  });

  it.each(["Prompt", "Hotkey"])(
    "retains an explicit empty %s string rather than treating it as cancellation",
    async (field) => {
      const setup = harness([
        select(field),
        select("Edit"),
        editor(""),
        select("Save"),
      ]);
      const result = await openRpcEditor(setup.ui, setup.options);

      if (result.kind !== "submitted") throw new Error("Expected submission.");

      expect(
        result.draft.preset[field === "Prompt" ? "instructions" : "hotkey"],
      ).toBe("");
      setup.finished();
    },
  );

  it("clears prompt, hotkey, and order explicitly without converting empty order to zero", async () => {
    const setup = harness([
      select("Prompt"),
      select("Clear"),
      select("Hotkey"),
      select("Clear"),
      select("Order"),
      editor("  ", "0"),
      select("Save"),
    ]);
    const result = await openRpcEditor(setup.ui, setup.options);

    if (result.kind !== "submitted") throw new Error("Expected submission.");

    expect(result.draft.preset).not.toHaveProperty("instructions");
    expect(result.draft.preset).not.toHaveProperty("hotkey");
    expect(result.draft.preset).not.toHaveProperty("order");
    setup.finished();
  });

  it("retries invalid order and multiline fields with typed values prefilled, retaining zero", async () => {
    const setup = harness([
      select("Order"),
      editor("Infinity", "0"),
      editor("NaN", "Infinity"),
      editor("0", "NaN"),
      select("Name"),
      editor("bad\nname", PRESET.name),
      editor("Good", "bad\nname"),
      select("Save"),
    ]);

    expect(await openRpcEditor(setup.ui, setup.options)).toMatchObject({
      draft: { preset: { name: "Good", order: 0 } },
    });

    expect(
      setup.notify.mock.calls.filter(([message]) =>
        /finite number|single line/.test(String(message)),
      ),
    ).toHaveLength(3);
    setup.finished();
  });

  it("cancels every field subdialog without changing the draft or asking to discard", async () => {
    const setup = harness([
      select("Name"),
      editor(),
      select("Scope"),
      select(),
      select("Provider"),
      select(),
      select("Model"),
      select(),
      select("Provider"),
      select("Enter ID Manually"),
      editor(),
      select("Model"),
      select("Enter ID Manually"),
      editor(),
      select(THINKING_LABEL),
      select(),
      select("Tools"),
      select(/"bash"/),
      select("Add Tool"),
      editor("new"),
      select("Cancel"),
      select("Tools"),
      select(),
      select("Prompt"),
      select(),
      select("Prompt"),
      select("Back"),
      select("Prompt"),
      select("Edit"),
      editor(),
      select("Hotkey"),
      select("Edit"),
      editor(),
      select("Order"),
      editor("Infinity"),
      editor(),
      select("Save"),
    ]);

    expect(await openRpcEditor(setup.ui, setup.options)).toStrictEqual({
      kind: "submitted",
      intent: "save",
      draft: BASELINE,
    });
    expect(setup.confirm).not.toHaveBeenCalled();
    setup.finished();
  });

  it.each([undefined, "Cancel"])(
    "cancels a pristine editor on %s without confirmation",
    async (choice) => {
      const setup = harness([select(choice)]);

      expect(await openRpcEditor(setup.ui, setup.options)).toEqual({
        kind: "cancelled",
      });
      expect(setup.confirm).not.toHaveBeenCalled();
      setup.finished();
    },
  );

  it("retains dirty changes after both outer cancellations are refused", async () => {
    const setup = harness([
      select("Name"),
      editor("Changed"),
      select(),
      { kind: "confirm", value: false },
      select("Cancel"),
      { kind: "confirm", value: false },
      select("Save"),
    ]);

    expect(await openRpcEditor(setup.ui, setup.options)).toMatchObject({
      draft: {
        preset: {
          name: "Changed",
          instructions: PRESET.instructions,
          order: 0,
        },
      },
    });
    expect(setup.confirm).toHaveBeenCalledTimes(2);
    setup.finished();
  });

  it("confirms discarding a dirty draft and avoids confirmation after exact reversion", async () => {
    const setup = harness([
      select("Name"),
      editor("Changed"),
      select("Cancel"),
      { kind: "confirm", value: true },
    ]);

    expect(await openRpcEditor(setup.ui, setup.options)).toEqual({
      kind: "cancelled",
    });
    setup.finished();

    const reverted = harness([
      select("Name"),
      editor("Changed"),
      select("Name"),
      editor(PRESET.name),
      select("Cancel"),
    ]);

    expect(await openRpcEditor(reverted.ui, reverted.options)).toEqual({
      kind: "cancelled",
    });
    expect(reverted.confirm).not.toHaveBeenCalled();
    reverted.finished();
  });

  it("keeps invalid drafts after blocked saves, reports issues, and submits after repair", async () => {
    const setup = harness(
      [
        select("Name"),
        editor("Taken"),
        select("Prompt"),
        select("Edit"),
        editor(" \n unsaved \n "),
        select("Save"),
        select("Name"),
        editor("Fixed"),
        select("Hotkey"),
        select("Edit"),
        editor("bad-key"),
        select("Save And Apply"),
        select("Hotkey"),
        select("Edit"),
        editor("ctrl+c"),
        select("Save And Apply"),
      ],
      { presets: [{ ...PRESET, name: "Taken", scope: "user" }] },
    );

    expect(await openRpcEditor(setup.ui, setup.options)).toMatchObject({
      kind: "submitted",
      intent: "save-apply",
      draft: {
        preset: {
          name: "Fixed",
          instructions: " \n unsaved \n ",
          hotkey: "ctrl+c",
          order: 0,
        },
      },
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
      "warning",
    );

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("unsupported key"),
      "warning",
    );

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("Pi built-in"),
      "warning",
    );
    setup.finished();
  });

  it("reopens a failed initial draft against the original baseline without losing edits", async () => {
    const initial: RpcPresetDraft = {
      ...BASELINE,
      preset: {
        ...PRESET,
        name: "Failed Save",
        instructions: "\n draft \n",
        tools: [],
      },
    };
    const setup = harness(
      [select("Cancel"), { kind: "confirm", value: false }, select("Save")],
      {
        initial,
        issues: [
          {
            field: "name",
            severity: "error",
            message: "The destination changed. Try again.",
          },
        ],
      },
    );

    expect(await openRpcEditor(setup.ui, setup.options)).toStrictEqual({
      kind: "submitted",
      intent: "save",
      draft: initial,
    });
    expect(initial.preset.instructions).toBe("\n draft \n");
    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("destination changed"),
      "warning",
    );
    expect(setup.confirm).toHaveBeenCalledOnce();
    setup.finished();
  });

  it("blocks untrusted Project scope and allows repair to User scope without losing other fields", async () => {
    const setup = harness(
      [
        select("Scope"),
        select("Project"),
        select("Save"),
        select("Scope"),
        select("User"),
        select("Save"),
      ],
      { projectTrusted: false },
    );

    expect(await openRpcEditor(setup.ui, setup.options)).toStrictEqual({
      kind: "submitted",
      intent: "save",
      draft: BASELINE,
    });

    expect(setup.notify).toHaveBeenCalledWith(
      expect.stringContaining("Trust this project"),
      "warning",
    );
    setup.finished();
  });
});
