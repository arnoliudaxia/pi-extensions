/** Exercise the RPC picker through the router and the shared activation pipeline. */
import { join } from "node:path";

import * as activation from "../../../src/activation/activate.js";
import { ActivePresetSession } from "../../../src/activation/session.js";
import { runPresetsCommand } from "../../../src/commands/presets/router.js";
import { HotkeyRegistry } from "../../../src/hotkey-registry.js";
import * as store from "../../../src/store/api.js";
import type { Preset, PresetScope } from "../../../src/types.js";
import { makeStubModelRegistry } from "../../helpers/model-registry.js";
import {
  createFakeContext,
  createFakePi,
  createTempConfigDirs,
  type TempConfigDirs,
} from "../../support/index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dirs: TempConfigDirs;

const PRESET: Preset = {
  name: "Deep Work",
  provider: "anthropic",
  model: "claude",
  thinkingLevel: "high",
};

function harness(choice?: number, override = false) {
  const notify = vi.fn();
  const select = vi.fn((_title: string, options: string[]) =>
    Promise.resolve(choice === undefined ? undefined : options[choice]),
  );
  const confirm = vi.fn(() => Promise.resolve(override));
  const ctx = createFakeContext({
    cwd: dirs.cwd,
    mode: "rpc",
    modelRegistry: makeStubModelRegistry({
      models: {
        anthropic: {
          claude: { hasKey: true, reasoning: true },
          locked: { hasKey: false },
        },
      },
    }),
    ui: { notify, select, confirm },
  });
  const custom = vi.spyOn(ctx.ui, "custom");
  const setModel = vi.fn<ExtensionAPI["setModel"]>(() => Promise.resolve(true));
  const setThinkingLevel = vi.fn<ExtensionAPI["setThinkingLevel"]>();
  const fake = createFakePi({ setModel, setThinkingLevel });
  const session = new ActivePresetSession();
  const deps = { hotkeys: new HotkeyRegistry(), pi: fake.pi, session };

  return {
    confirm,
    ctx,
    custom,
    deps,
    fake,
    notify,
    select,
    session,
    setModel,
    setThinkingLevel,
  };
}

async function writeConfig(
  presets: readonly Preset[],
  scope: PresetScope = "user",
  rules: readonly unknown[] = [],
): Promise<void> {
  await dirs.writeJson(
    scope === "user"
      ? join(dirs.agentDir, "presets-plus", "config.json")
      : join(dirs.cwd, ".pi", "presets-plus", "config.json"),
    {
      version: 2,
      presets,
      ...(scope === "user" ? { policy: { rules } } : {}),
    },
  );
}

beforeEach(async () => {
  dirs = await createTempConfigDirs();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await dirs.cleanup();
});

describe("RPC picker routing", () => {
  it.each([
    [0, "user"],
    [1, "project"],
  ] as const)(
    "activates the exact same-name selection %i in %s scope",
    async (choice, scope) => {
      await writeConfig([PRESET]);
      await writeConfig([{ ...PRESET, thinkingLevel: "low" }], "project");

      const setup = harness(choice);
      const load = vi.spyOn(store, "loadPresetsConfig");
      const activate = vi.spyOn(activation, "activate");

      await runPresetsCommand("  ", setup.ctx, setup.deps);

      expect(load).toHaveBeenCalledTimes(1);

      const result = load.mock.results[0];

      expect(result?.type).toBe("return");

      if (result?.type !== "return") {
        throw new Error("The configuration load did not return a promise.");
      }

      const loaded = await result.value;
      const request = activate.mock.calls[0]?.[3];

      expect(activate).toHaveBeenCalledExactlyOnceWith(
        setup.ctx,
        setup.fake.pi,
        setup.session,
        { preset: loaded?.presets[choice], trigger: "picker", config: loaded },
      );
      expect(request?.config).toBe(loaded);
      expect(request && "preset" in request ? request.preset : undefined).toBe(
        loaded?.presets[choice],
      );

      expect(setup.session.current()).toMatchObject({
        name: PRESET.name,
        scope,
      });

      expect(setup.setThinkingLevel).toHaveBeenCalledWith(
        scope === "user" ? "high" : "low",
      );

      expect(setup.notify).toHaveBeenCalledExactlyOnceWith(
        'Preset "Deep Work" applied.',
        "info",
      );

      expect(setup.custom).not.toHaveBeenCalled();
    },
  );

  it("does not activate when selection is cancelled", async () => {
    await writeConfig([PRESET]);

    const setup = harness();
    const activate = vi.spyOn(activation, "activate");

    await runPresetsCommand("", setup.ctx, setup.deps);

    expect(setup.select).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
    expect(setup.setModel).not.toHaveBeenCalled();
    expect(setup.notify).not.toHaveBeenCalled();
    expect(setup.custom).not.toHaveBeenCalled();
    expect(setup.session.current()).toBeUndefined();
  });

  it("offers management in an empty store without activating on cancellation", async () => {
    const setup = harness();
    const activate = vi.spyOn(activation, "activate");

    await runPresetsCommand("", setup.ctx, setup.deps);

    expect(setup.notify).not.toHaveBeenCalled();
    expect(setup.select).toHaveBeenCalledExactlyOnceWith("Presets Plus", [
      "Manage Presets",
    ]);
    expect(activate).not.toHaveBeenCalled();
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "uses the shared policy confirmation with override %j",
    async (override) => {
      await writeConfig([PRESET], "user", [
        { match: ".", prohibit: [{ pattern: "^Deep Work$" }] },
      ]);

      const setup = harness(0, override);

      await runPresetsCommand("", setup.ctx, setup.deps);

      expect(setup.confirm).toHaveBeenCalledExactlyOnceWith(
        "Preset Doesn't Match Policy",
        'The access policy for this directory does not permit preset "Deep Work". Activate it anyway?',
      );
      expect(setup.setModel).toHaveBeenCalledTimes(override ? 1 : 0);
      expect(setup.fake.appendedEntries).toHaveLength(override ? 1 : 0);
      expect(setup.notify).toHaveBeenCalledTimes(override ? 1 : 0);
      expect(setup.custom).not.toHaveBeenCalled();
    },
  );

  it("keeps the loaded policy snapshot while the selection is open", async () => {
    await writeConfig([PRESET], "user", [
      { match: ".", prohibit: [{ pattern: "^Deep Work$" }] },
    ]);

    const setup = harness(0);
    const load = vi.spyOn(store, "loadPresetsConfig");

    setup.select.mockImplementationOnce(async (_title, options) => {
      await writeConfig([PRESET]);

      return options[0];
    });

    await runPresetsCommand("", setup.ctx, setup.deps);

    expect(load).toHaveBeenCalledTimes(1);
    expect(setup.confirm).toHaveBeenCalledTimes(1);
    expect(setup.setModel).not.toHaveBeenCalled();
    expect(setup.custom).not.toHaveBeenCalled();
  });

  it("reports an unavailable selection without opening a custom dialog", async () => {
    await writeConfig([{ ...PRESET, model: "locked" }]);

    const setup = harness(0);

    await runPresetsCommand("", setup.ctx, setup.deps);

    expect(setup.notify).toHaveBeenCalledExactlyOnceWith(
      'Preset "Deep Work" is unavailable because its provider has no API key. Pi did not activate it.',
      "error",
    );
    expect(setup.setModel).not.toHaveBeenCalled();
    expect(setup.session.current()).toBeUndefined();
    expect(setup.custom).not.toHaveBeenCalled();
  });
});
