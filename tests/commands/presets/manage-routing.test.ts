/** Keep management routing, mode gates, and per-session interaction ownership explicit. */
import { ActivePresetSession } from "../../../src/activation/session.js";
import {
  getArgumentCompletions,
  runPresetsCommand,
} from "../../../src/commands/presets/router.js";
import { HotkeyRegistry } from "../../../src/hotkey-registry.js";
import {
  createDeferred,
  createFakeContext,
  createFakePi,
  createTempConfigDirs,
  type TempConfigDirs,
} from "../../support/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { manage } = vi.hoisted(() => ({
  manage:
    vi.fn<
      typeof import("../../../src/commands/presets/manage.js").runPresetManager
    >(),
}));

vi.mock("../../../src/commands/presets/manage.js", () => ({
  runPresetManager: manage,
}));

let dirs: TempConfigDirs;

beforeEach(async () => {
  dirs = await createTempConfigDirs();
  manage.mockReset().mockResolvedValue({ kind: "closed" });
});

afterEach(async () => {
  await dirs.cleanup();
});

function dependencies() {
  return {
    hotkeys: new HotkeyRegistry(),
    pi: createFakePi().pi,
    session: new ActivePresetSession(),
  };
}

describe("preset management routing", () => {
  it("registers the manage subcommand in argument completions", async () => {
    expect(await getArgumentCompletions("man")).toEqual([
      { label: "manage", value: "manage", description: "Manage presets" },
    ]);
  });

  it.each(["rpc", "tui"] as const)("opens management in %s", async (mode) => {
    const ctx = createFakeContext({ cwd: dirs.cwd, mode });
    const deps = dependencies();

    await runPresetsCommand("manage", ctx, deps);

    expect(manage).toHaveBeenCalledExactlyOnceWith(ctx, deps);
  });

  it.each(["rpc", "print", "json"] as const)(
    "does not open management without an interactive UI in %s",
    async (mode) => {
      const ctx = createFakeContext({ cwd: dirs.cwd, mode });
      const notify = vi.spyOn(ctx.ui, "notify");

      Object.assign(ctx, { hasUI: mode !== "rpc" });

      await runPresetsCommand("manage", ctx, dependencies());

      expect(manage).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledExactlyOnceWith(
        "Preset management needs an interactive client.",
        "warning",
      );
    },
  );

  it("opens management from the empty RPC picker", async () => {
    const ctx = createFakeContext({ cwd: dirs.cwd, mode: "rpc" });
    const select = vi
      .spyOn(ctx.ui, "select")
      .mockResolvedValue("Manage Presets");
    const deps = dependencies();

    await runPresetsCommand("", ctx, deps);

    expect(select).toHaveBeenCalledExactlyOnceWith("Presets Plus", [
      "Manage Presets",
    ]);
    expect(manage).toHaveBeenCalledExactlyOnceWith(ctx, deps);
  });

  it("requires one manager to finish before opening another for the same session", async () => {
    const ctx = createFakeContext({ cwd: dirs.cwd, mode: "rpc" });
    const notify = vi.spyOn(ctx.ui, "notify");
    const deps = dependencies();
    const pending = createDeferred<Awaited<ReturnType<typeof manage>>>();

    manage.mockImplementationOnce(() => pending.promise);

    const first = runPresetsCommand("manage", ctx, deps);

    await runPresetsCommand("manage", ctx, deps);

    expect(manage).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "A preset manager is already open in this session.",
      "warning",
    );

    pending.resolve({ kind: "closed" });
    await first;
    await runPresetsCommand("manage", ctx, deps);

    expect(manage).toHaveBeenCalledTimes(2);
  });

  it("releases ownership after a management error", async () => {
    const ctx = createFakeContext({ cwd: dirs.cwd, mode: "rpc" });
    const deps = dependencies();

    manage.mockRejectedValueOnce(new Error("dialog failed"));

    await expect(runPresetsCommand("manage", ctx, deps)).rejects.toThrow(
      "dialog failed",
    );
    await runPresetsCommand("manage", ctx, deps);

    expect(manage).toHaveBeenCalledTimes(2);
  });
});
