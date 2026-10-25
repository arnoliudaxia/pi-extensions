/** Cover lossless draft copies, exact dirty checks, and save-boundary validation. */
import type { LoadedPreset, Preset } from "../../src/types.js";
import {
  cloneRpcDraft,
  sameRpcDraft,
  validateRpcDraft,
} from "../../src/ui/editor/rpc-draft.js";
import type { RpcPresetDraft } from "../../src/ui/rpc-editor-types.js";
import { describe, expect, it } from "vitest";

const PRESET: Preset = {
  name: "  Work  ",
  provider: "manual-provider",
  model: "unknown-model",
  thinkingLevel: "off",
  tools: ["unknown", "read", "unknown"],
  instructions: " \n  Keep whitespace.\t\n\n",
  hotkey: " Shift+Ctrl+1 ",
  order: 0,
};
const DRAFT: RpcPresetDraft = { scope: "user", preset: PRESET };

function loaded(
  name: string,
  scope: "user" | "project" = "user",
): LoadedPreset {
  return { ...PRESET, name, scope };
}

describe("RPC draft copies and equality", () => {
  it("clones all fields without normalizing whitespace, tools, hotkeys, or order", () => {
    const copy = cloneRpcDraft(DRAFT);

    expect(copy).toStrictEqual(DRAFT);
    expect(copy).not.toBe(DRAFT);
    expect(copy.preset).not.toBe(DRAFT.preset);
    expect(copy.preset.tools).not.toBe(DRAFT.preset.tools);
    expect(sameRpcDraft(copy, DRAFT)).toBe(true);
    copy.preset.tools?.push("bash");
    copy.preset.name = "changed";
    expect(DRAFT.preset).toStrictEqual(PRESET);
    expect(DRAFT.preset.tools).toEqual(["unknown", "read", "unknown"]);
  });

  it("retains omitted fields instead of synthesizing defaults", () => {
    const draft: RpcPresetDraft = {
      scope: "project",
      preset: { name: "minimal", provider: "p", model: "m" },
    };

    expect(cloneRpcDraft(draft)).toStrictEqual(draft);
    expect(Object.keys(cloneRpcDraft(draft).preset)).toEqual([
      "name",
      "provider",
      "model",
    ]);
  });

  it.each([
    { name: "Work" },
    { provider: "other" },
    { model: "other" },
    { thinkingLevel: undefined },
    { tools: [] },
    { tools: ["read", "unknown", "unknown"] },
    { instructions: "" },
    { instructions: PRESET.instructions?.trim() },
    { hotkey: "ctrl+shift+1" },
    { order: undefined },
    { order: 1 },
  ] satisfies Partial<Preset>[])(
    "detects an exact persisted change: %j",
    (change) => {
      expect(
        sameRpcDraft(DRAFT, { ...DRAFT, preset: { ...PRESET, ...change } }),
      ).toBe(false);
    },
  );

  it("distinguishes omitted values from off, empty arrays, empty strings, and zero", () => {
    for (const field of [
      "thinkingLevel",
      "tools",
      "instructions",
      "hotkey",
      "order",
    ] as const) {
      const copy = cloneRpcDraft(DRAFT);

      delete copy.preset[field];
      expect(sameRpcDraft(DRAFT, copy)).toBe(false);
    }

    const minimal = { name: "n", provider: "p", model: "m" };

    for (const value of [
      { instructions: "" },
      { hotkey: "" },
      { tools: [] },
      { thinkingLevel: "off" },
      { order: 0 },
    ] satisfies Partial<Preset>[]) {
      expect(
        sameRpcDraft(
          { scope: "user", preset: minimal },
          { scope: "user", preset: { ...minimal, ...value } },
        ),
      ).toBe(false);
    }

    expect(sameRpcDraft(DRAFT, { ...DRAFT, scope: "project" })).toBe(false);
  });

  it("ignores property insertion order but retains explicitly undefined fields", () => {
    expect(
      sameRpcDraft(DRAFT, { scope: "user", preset: { order: 0, ...PRESET } }),
    ).toBe(true);

    const minimal = { name: "n", provider: "p", model: "m" };
    const explicit = { ...minimal, instructions: undefined };

    expect(
      cloneRpcDraft({ scope: "user", preset: explicit }).preset,
    ).toHaveProperty("instructions");

    expect(
      sameRpcDraft(
        { scope: "user", preset: minimal },
        { scope: "user", preset: explicit },
      ),
    ).toBe(false);
  });
});

describe("validateRpcDraft", () => {
  it("accepts unknown providers and models without registry or auth dependencies", () => {
    expect(validateRpcDraft(DRAFT, { presets: [] })).toEqual([]);
    expect(
      validateRpcDraft(
        {
          ...DRAFT,
          preset: { ...PRESET, instructions: "", hotkey: "", tools: [] },
        },
        { presets: [] },
      ),
    ).toEqual([]);
  });

  it.each([
    ["name", ""],
    ["provider", ""],
    ["model", ""],
    ["thinkingLevel", "invalid"],
    ["tools", [42]],
    ["instructions", 42],
    ["hotkey", 42],
    ["order", Number.NaN],
    ["order", Number.POSITIVE_INFINITY],
    ["order", "0"],
  ])("reuses storage shape validation for %s=%j", (field, value) => {
    const draft = {
      ...DRAFT,
      preset: { ...PRESET, [field]: value },
    } as RpcPresetDraft;
    const issues = validateRpcDraft(draft, { presets: [] });

    expect(issues).toEqual([
      expect.objectContaining({ field, severity: "error" }),
    ]);
  });

  it("rejects same-scope collisions, excluding only the replaced identity", () => {
    const presets = [
      loaded("Work"),
      loaded("Work", "project"),
      loaded("Other"),
    ];
    const draft: RpcPresetDraft = {
      scope: "user",
      preset: { ...PRESET, name: "Work", hotkey: "" },
    };

    expect(validateRpcDraft(draft, { presets })).toEqual([
      expect.objectContaining({ field: "name", severity: "error" }),
    ]);

    expect(
      validateRpcDraft(draft, {
        presets,
        replaces: { name: "Work", scope: "user" },
      }),
    ).toEqual([]);

    expect(
      validateRpcDraft(draft, {
        presets,
        replaces: { name: "Work", scope: "project" },
      }),
    ).toEqual([expect.objectContaining({ field: "name", severity: "error" })]);

    expect(
      validateRpcDraft(draft, { presets: [loaded("Work", "project")] }),
    ).toEqual([]);
  });

  it("checks destination and source trust, with optional trust for storage callers", () => {
    const draft: RpcPresetDraft = { ...DRAFT, scope: "project" };

    expect(validateRpcDraft(draft, { presets: [] })).toEqual([]);
    expect(
      validateRpcDraft(draft, { presets: [], projectTrusted: true }),
    ).toEqual([]);

    expect(
      validateRpcDraft(draft, { presets: [], projectTrusted: false }),
    ).toEqual([expect.objectContaining({ field: "scope", severity: "error" })]);

    expect(
      validateRpcDraft(DRAFT, {
        presets: [],
        replaces: { name: "Old", scope: "project" },
        projectTrusted: false,
      }),
    ).toEqual([expect.objectContaining({ field: "scope", severity: "error" })]);

    expect(
      validateRpcDraft(
        { ...DRAFT, scope: "bad" } as unknown as RpcPresetDraft,
        { presets: [] },
      ),
    ).toEqual([expect.objectContaining({ field: "scope", severity: "error" })]);
  });

  it("uses shared diagnostics for invalid, built-in, conflicted, and unchanged hotkeys", () => {
    const check = (hotkey: string, presets: LoadedPreset[] = []) =>
      validateRpcDraft(
        { ...DRAFT, preset: { ...PRESET, hotkey } },
        { presets },
      );

    expect(check("ctrl+unknown")).toEqual([
      expect.objectContaining({ field: "hotkey", severity: "error" }),
    ]);

    expect(check("ctrl+c")).toEqual([
      expect.objectContaining({
        field: "hotkey",
        severity: "warning",
        message: expect.stringContaining("Pi built-in") as unknown,
      }),
    ]);

    expect(check("ctrl+shift+1", [loaded("Owner")])).toEqual([
      expect.objectContaining({
        field: "hotkey",
        severity: "warning",
        message: expect.stringContaining("Owner") as unknown,
      }),
    ]);

    expect(
      validateRpcDraft(DRAFT, {
        presets: [{ ...PRESET, scope: "user" }],
        replaces: { name: PRESET.name, scope: "user" },
      }),
    ).toEqual([]);
  });
});
