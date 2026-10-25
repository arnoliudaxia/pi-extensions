/** Cover standard RPC selection, preset metadata, and exact option identity. */
import type { LoadedPreset } from "../../src/types.js";
import { openRpcPicker } from "../../src/ui/rpc-picker.js";
import {
  createFakeContext,
  createShownTextRecorder,
  findShownTextViolations,
} from "@sherif-fanous/pi-extensions-testing";
import { describe, expect, it, vi } from "vitest";

const PRESET: LoadedPreset = {
  name: "Deep Work",
  provider: "anthropic",
  model: "claude",
  scope: "user",
  thinkingLevel: "high",
};

function harness(choice?: number | string) {
  const notify = vi.fn();
  const select = vi.fn((_title: string, options: string[]) =>
    Promise.resolve(typeof choice === "number" ? options[choice] : choice),
  );
  const ctx = createFakeContext({ mode: "rpc", ui: { notify, select } });
  const custom = vi.spyOn(ctx.ui, "custom");

  return { ctx, custom, notify, select };
}

describe("openRpcPicker", () => {
  it("shows scope, model, thinking, and availability through standard select", async () => {
    const setup = harness(0);

    await expect(openRpcPicker(setup.ctx, [PRESET])).resolves.toBe(PRESET);

    expect(setup.select).toHaveBeenCalledExactlyOnceWith("Presets Plus", [
      '1. "Deep Work" · Scope: User · Model: anthropic / claude · Thinking level: High · Status: Available',
    ]);
    expect(setup.custom).not.toHaveBeenCalled();
    expect(setup.notify).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    "maps same-name scopes to the exact object at %i",
    async (choice) => {
      const presets: LoadedPreset[] = [
        { ...PRESET, shadowed: true },
        { ...PRESET, scope: "project" },
      ];
      const setup = harness(choice);

      await expect(openRpcPicker(setup.ctx, presets)).resolves.toBe(
        presets[choice],
      );

      const options = setup.select.mock.calls[0]?.[1] ?? [];

      expect(new Set(options).size).toBe(2);
      expect(options[0]).toContain("Scope: User");
      expect(options[0]).toContain("Project preset takes precedence by name.");
      expect(options[1]).toContain("Scope: Project");
      expect(setup.custom).not.toHaveBeenCalled();
    },
  );

  it("keeps options unique even for identical display metadata", async () => {
    const duplicate = { ...PRESET };
    const setup = harness(1);

    await expect(openRpcPicker(setup.ctx, [PRESET, duplicate])).resolves.toBe(
      duplicate,
    );

    const options = setup.select.mock.calls[0]?.[1] ?? [];

    expect(new Set(options).size).toBe(2);
  });

  it.each([undefined, "Deep Work", "0", "unknown"])(
    "returns no preset for a cancelled or unmatched response %j",
    async (choice) => {
      const setup = harness(choice);

      await expect(openRpcPicker(setup.ctx, [PRESET])).resolves.toBeUndefined();
      expect(setup.notify).not.toHaveBeenCalled();
      expect(setup.custom).not.toHaveBeenCalled();
    },
  );

  it("notifies an empty list without opening a prompt", async () => {
    const setup = harness();

    await expect(openRpcPicker(setup.ctx, [])).resolves.toBeUndefined();

    expect(setup.notify).toHaveBeenCalledExactlyOnceWith(
      "No presets loaded. Add one to your configuration and try again.",
      "info",
    );
    expect(setup.select).not.toHaveBeenCalled();
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it("shows unavailable reasons, default thinking, and clamping", async () => {
    const setup = harness();

    await openRpcPicker(setup.ctx, [
      { ...PRESET, unavailable: "no-key", clampWarning: true },
      {
        ...PRESET,
        name: "missing",
        unavailable: "no-model",
        thinkingLevel: undefined,
      },
    ]);

    const options = setup.select.mock.calls[0]?.[1] ?? [];

    expect(options[0]).toContain("no API key configured.");
    expect(options[0]).toContain("Thinking will be clamped.");
    expect(options[1]).toContain("model is no longer available.");
    expect(options[1]).toContain("Thinking level: Off");
  });

  it("follows the shown-text standard for selection and empty state", async () => {
    const recorder = createShownTextRecorder();
    const ctx = createFakeContext({
      mode: "rpc",
      ui: { notify: recorder.notify, select: recorder.select },
    });

    await openRpcPicker(ctx, [PRESET]);
    await openRpcPicker(ctx, []);

    expect(
      findShownTextViolations(recorder, {
        displayName: "Presets Plus",
        slug: "presets-plus",
      }),
    ).toEqual([]);
  });
});
