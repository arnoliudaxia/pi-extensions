/** Exercise optimistic commits, safety refusals, and queue recovery on real files. */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  loadPresetsConfig,
  saveScope,
  type StorageContext,
} from "../../src/store/api.js";
import { PRESETS_PLUS_CONFIG } from "../../src/store/config.js";
import {
  commitPresetMutation,
  type PresetMutation,
  type PresetSnapshot,
} from "../../src/store/mutations.js";
import type { LoadedPreset, Preset, PresetScope } from "../../src/types.js";
import { makeStubModelRegistry } from "../helpers/model-registry.js";
import {
  createDeferred,
  createTempConfigDirs,
  type TempConfigDirs,
} from "../support/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dirs: TempConfigDirs;
let ctx: StorageContext;
let trusted: boolean;

async function contents(scope: PresetScope): Promise<string> {
  return readFile(path(scope), "utf8");
}

async function names(scope: PresetScope): Promise<string[]> {
  const loaded = await loadPresetsConfig(ctx);

  return loaded.presets
    .filter((entry) => entry.scope === scope)
    .map((entry) => entry.name);
}

function path(scope: PresetScope): string {
  return PRESETS_PLUS_CONFIG.path(ctx, scope);
}

function preset(name: string, extra: Partial<Preset> = {}): Preset {
  return { name, provider: "test", model: "model", ...extra };
}

async function raw(scope: PresetScope, contents: string): Promise<void> {
  await mkdir(dirname(path(scope)), { recursive: true });
  await writeFile(path(scope), contents, "utf8");
}

function snapshot(
  name: string,
  scope: PresetScope = "user",
  extra: Partial<Preset> = {},
): PresetSnapshot {
  return { identity: { name, scope }, preset: preset(name, extra) };
}

beforeEach(async () => {
  dirs = await createTempConfigDirs();
  trusted = true;
  ctx = {
    cwd: dirs.cwd,
    isProjectTrusted: () => trusted,
    modelRegistry: makeStubModelRegistry({ models: {} }),
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await dirs.cleanup();
});

describe("commitPresetMutation", () => {
  it("creates, renames in place, moves, reorders, and deletes without a UI", async () => {
    await saveScope("user", [preset("a"), preset("b")], ctx);
    await raw(
      "project",
      JSON.stringify({
        version: 2,
        unknown: "retained",
        showInactiveStatus: false,
      }),
    );

    expect(
      await commitPresetMutation(ctx, {
        kind: "create",
        scope: "user",
        preset: preset("c"),
      }),
    ).toEqual({
      ok: true,
      changed: true,
      saved: snapshot("c"),
    });

    expect(
      await commitPresetMutation(ctx, {
        kind: "replace",
        expected: snapshot("b"),
        scope: "user",
        preset: preset("renamed"),
      }),
    ).toEqual({
      ok: true,
      changed: true,
      saved: snapshot("renamed"),
    });
    expect(await names("user")).toEqual(["a", "renamed", "c"]);
    expect(
      await commitPresetMutation(ctx, {
        kind: "reorder",
        scope: "user",
        expectedNames: ["a", "renamed", "c"],
        orderedNames: ["c", "a", "renamed"],
      }),
    ).toEqual({ ok: true, changed: true });
    expect(await names("user")).toEqual(["c", "a", "renamed"]);
    expect(
      await commitPresetMutation(ctx, {
        kind: "replace",
        expected: snapshot("renamed"),
        scope: "project",
        preset: preset("moved"),
      }),
    ).toEqual({
      ok: true,
      changed: true,
      saved: snapshot("moved", "project"),
    });
    expect(await names("user")).toEqual(["c", "a"]);
    expect(JSON.parse(await contents("project"))).toEqual({
      version: 2,
      unknown: "retained",
      showInactiveStatus: false,
      presets: [preset("moved")],
    });

    expect(
      await commitPresetMutation(ctx, {
        kind: "delete",
        expected: snapshot("moved", "project"),
      }),
    ).toEqual({ ok: true, changed: true });
    expect(await names("project")).toEqual([]);
  });

  it("preserves settings, policy, unknown keys, and serialized field schema", async () => {
    const document = {
      version: 2,
      showInactiveStatus: false,
      policy: { rules: [{ match: "work" }] },
      unknown: { keep: true },
      presets: [],
    };

    await raw("user", JSON.stringify(document));

    const loaded: LoadedPreset = {
      ...preset("a", {
        tools: ["read"],
        instructions: "text",
        order: 4,
        thinkingLevel: "high",
        hotkey: "ctrl+x",
      }),
      scope: "user",
      unavailable: "no-model",
      shadowed: true,
    };
    const result = await commitPresetMutation(ctx, {
      kind: "create",
      scope: "user",
      preset: loaded,
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(JSON.parse(await contents("user"))).toEqual({
      ...document,
      presets: [
        preset("a", {
          tools: ["read"],
          instructions: "text",
          order: 4,
          thinkingLevel: "high",
          hotkey: "ctrl+x",
        }),
      ],
    });
    expect(await contents("user")).not.toContain("unavailable");
    expect(await contents("user")).not.toContain("shadowed");
  });

  it("compares persisted fields only and skips unchanged writes", async () => {
    await saveScope("user", [preset("a")], ctx);

    const expected: PresetSnapshot = {
      identity: { name: "a", scope: "user" },
      preset: {
        ...preset("a"),
        scope: "user",
        unavailable: "no-model",
      } as LoadedPreset,
    };
    const write = vi.spyOn(PRESETS_PLUS_CONFIG, "update");

    expect(
      await commitPresetMutation(ctx, {
        kind: "replace",
        expected,
        scope: "user",
        preset: preset("a"),
      }),
    ).toEqual({ ok: true, changed: false, saved: snapshot("a") });

    expect(
      await commitPresetMutation(ctx, {
        kind: "reorder",
        scope: "user",
        expectedNames: ["a"],
        orderedNames: ["a"],
      }),
    ).toEqual({ ok: true, changed: false });
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    "provider",
    "model",
    "thinkingLevel",
    "tools",
    "instructions",
    "hotkey",
    "order",
  ] as const)(
    "rejects stale edits and deletes after %s changes",
    async (field) => {
      const changes: Partial<Preset> = {
        provider: "other",
        model: "other",
        thinkingLevel: "high",
        tools: ["read"],
        instructions: "external",
        hotkey: "ctrl+x",
        order: 3,
      };

      await saveScope("user", [preset("a", { [field]: changes[field] })], ctx);

      const original = await contents("user");

      for (const mutation of [
        {
          kind: "replace",
          expected: snapshot("a"),
          scope: "user",
          preset: preset("new"),
        },
        { kind: "delete", expected: snapshot("a") },
      ] satisfies PresetMutation[]) {
        expect(await commitPresetMutation(ctx, mutation)).toMatchObject({
          ok: false,
          code: "conflict",
        });
        expect(await contents("user")).toBe(original);
      }
    },
  );

  it("does not resurrect a deleted preset or delete a replacement", async () => {
    await saveScope("user", [], ctx);
    expect(
      await commitPresetMutation(ctx, {
        kind: "replace",
        expected: snapshot("a"),
        scope: "user",
        preset: preset("a"),
      }),
    ).toMatchObject({ ok: false, code: "conflict" });

    expect(
      await commitPresetMutation(ctx, {
        kind: "delete",
        expected: snapshot("a"),
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await names("user")).toEqual([]);
  });

  it.each([["b", "a"], ["a", "b", "c"], ["a"]])(
    "rejects a stale reorder after the list becomes %j",
    async (...current) => {
      await saveScope(
        "user",
        current.map((name) => preset(name)),
        ctx,
      );

      const original = await contents("user");

      expect(
        await commitPresetMutation(ctx, {
          kind: "reorder",
          scope: "user",
          expectedNames: ["a", "b"],
          orderedNames: ["b", "a"],
        }),
      ).toMatchObject({ ok: false, code: "conflict" });
      expect(await contents("user")).toBe(original);
    },
  );

  it("allows content changes during a reorder without overwriting them", async () => {
    await saveScope(
      "user",
      [preset("a", { instructions: "fresh" }), preset("b")],
      ctx,
    );

    expect(
      await commitPresetMutation(ctx, {
        kind: "reorder",
        scope: "user",
        expectedNames: ["a", "b"],
        orderedNames: ["b", "a"],
      }),
    ).toEqual({ ok: true, changed: true });

    expect(
      (await loadPresetsConfig(ctx)).presets.find((entry) => entry.name === "a")
        ?.instructions,
    ).toBe("fresh");
  });

  it("serializes two concurrent additions without losing either", async () => {
    const results = await Promise.all(
      ["a", "b"].map((name) =>
        commitPresetMutation(ctx, {
          kind: "create",
          scope: "user",
          preset: preset(name),
        }),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await names("user")).toEqual(["a", "b"]);
  });

  it("rejects the second concurrent same-name creation", async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        commitPresetMutation(ctx, {
          kind: "create",
          scope: "user",
          preset: preset("same"),
        }),
      ),
    );

    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: false, code: "collision" });
    expect(await names("user")).toEqual(["same"]);
  });

  it("lets only the first of two stale concurrent edits commit", async () => {
    await saveScope("user", [preset("a")], ctx);

    const results = await Promise.all(
      ["first", "second"].map((instructions) =>
        commitPresetMutation(ctx, {
          kind: "replace",
          expected: snapshot("a"),
          scope: "user",
          preset: preset("a", { instructions }),
        }),
      ),
    );

    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: false, code: "conflict" });
    expect((await loadPresetsConfig(ctx)).presets[0]?.instructions).toBe(
      "first",
    );
  });

  it("allows same names across scopes and changes only the selected identity", async () => {
    for (const scope of ["user", "project"] as const) {
      expect(
        await commitPresetMutation(ctx, {
          kind: "create",
          scope,
          preset: preset("same"),
        }),
      ).toMatchObject({ ok: true });
    }

    expect(
      await commitPresetMutation(ctx, {
        kind: "delete",
        expected: snapshot("same"),
      }),
    ).toEqual({ ok: true, changed: true });
    expect(await names("project")).toEqual(["same"]);
    expect(await names("user")).toEqual([]);
  });

  it("refuses rename and move collisions without touching either scope", async () => {
    await saveScope("user", [preset("a"), preset("taken")], ctx);
    await saveScope("project", [preset("taken")], ctx);

    const user = await contents("user");
    const project = await contents("project");
    const write = vi.spyOn(PRESETS_PLUS_CONFIG, "update");

    for (const scope of ["user", "project"] as const) {
      expect(
        await commitPresetMutation(ctx, {
          kind: "replace",
          expected: snapshot("a"),
          scope,
          preset: preset("taken"),
        }),
      ).toMatchObject({ ok: false, code: "collision" });
    }

    expect(write).not.toHaveBeenCalled();
    expect(await contents("user")).toBe(user);
    expect(await contents("project")).toBe(project);
  });

  it.each([
    { kind: "create", scope: "user", preset: preset("") },
    {
      kind: "create",
      scope: "user",
      preset: preset("bad", { order: Infinity }),
    },
    {
      kind: "create",
      scope: "user",
      preset: preset("bad", { hotkey: "ctrl+ctrl+a" }),
    },
    {
      kind: "replace",
      scope: "user",
      expected: snapshot("a"),
      preset: preset("bad", { provider: "" }),
    },
    {
      kind: "delete",
      expected: {
        identity: { name: "different", scope: "user" },
        preset: preset("a"),
      },
    },
    {
      kind: "reorder",
      scope: "user",
      expectedNames: ["a", "b"],
      orderedNames: ["a", "a"],
    },
    {
      kind: "reorder",
      scope: "user",
      expectedNames: ["a", "b"],
      orderedNames: ["b"],
    },
    {
      kind: "reorder",
      scope: "user",
      expectedNames: ["a", "b"],
      orderedNames: ["b", "unknown"],
    },
  ] satisfies PresetMutation[])(
    "validates an invalid $kind before writing",
    async (mutation) => {
      const write = vi.spyOn(PRESETS_PLUS_CONFIG, "update");

      expect(await commitPresetMutation(ctx, mutation)).toMatchObject({
        ok: false,
        code: "invalid",
      });
      expect(write).not.toHaveBeenCalled();
    },
  );
});

const unsafeDocuments = [
  "{ invalid json",
  "[]",
  JSON.stringify({ version: 99, presets: [preset("a")] }),
  JSON.stringify({
    version: 2,
    showInactiveStatus: "yes",
    presets: [preset("a")],
  }),
  JSON.stringify({
    version: 2,
    policy: { rules: "bad" },
    presets: [preset("a")],
  }),
  JSON.stringify({
    version: 2,
    policy: { rules: [{ match: "[" }] },
    presets: [preset("a")],
  }),
  JSON.stringify({ version: 2, presets: [preset("a"), preset("a")] }),
  JSON.stringify({ version: 2, presets: [preset("a"), { name: "invalid" }] }),
];

describe("fresh safety checks", () => {
  it.each(unsafeDocuments)(
    "refuses every affected-scope mutation and saveScope for unsafe file %s",
    async (document) => {
      await raw("user", document);

      const write = vi.spyOn(PRESETS_PLUS_CONFIG, "update");

      for (const mutation of [
        { kind: "create", scope: "user", preset: preset("new") },
        {
          kind: "replace",
          scope: "user",
          expected: snapshot("a"),
          preset: preset("new"),
        },
        { kind: "delete", expected: snapshot("a") },
        {
          kind: "reorder",
          scope: "user",
          expectedNames: ["a"],
          orderedNames: ["a"],
        },
      ] satisfies PresetMutation[]) {
        expect(await commitPresetMutation(ctx, mutation)).toMatchObject({
          ok: false,
          code: "unsafe",
        });
        expect(await contents("user")).toBe(document);
      }

      await expect(saveScope("user", [], ctx)).rejects.toMatchObject({
        code: "unsafe",
      });
      expect(write).not.toHaveBeenCalled();
      expect(await contents("user")).toBe(document);
    },
  );

  it("rejects project policy and unreadable configuration paths", async () => {
    const document = JSON.stringify({
      version: 2,
      policy: { rules: [] },
      presets: [],
    });

    await raw("project", document);
    expect(
      await commitPresetMutation(ctx, {
        kind: "create",
        scope: "project",
        preset: preset("new"),
      }),
    ).toMatchObject({ ok: false, code: "unsafe" });

    await expect(saveScope("project", [], ctx)).rejects.toMatchObject({
      code: "unsafe",
    });
    expect(await contents("project")).toBe(document);
    await mkdir(path("user"), { recursive: true });
    expect(
      await commitPresetMutation(ctx, {
        kind: "create",
        scope: "user",
        preset: preset("new"),
      }),
    ).toMatchObject({ ok: false, code: "unsafe" });
    expect((await stat(path("user"))).isDirectory()).toBe(true);
  });

  it.each(["user", "project"] as const)(
    "checks both scopes before a move when %s is unsafe",
    async (unsafeScope) => {
      await saveScope("user", [preset("a")], ctx);
      await saveScope("project", [preset("b")], ctx);
      await raw(unsafeScope, "{ invalid");

      const user = await contents("user");
      const project = await contents("project");
      const write = vi.spyOn(PRESETS_PLUS_CONFIG, "update");

      expect(
        await commitPresetMutation(ctx, {
          kind: "replace",
          expected: snapshot("a"),
          scope: "project",
          preset: preset("a"),
        }),
      ).toMatchObject({ ok: false, code: "unsafe" });
      expect(write).not.toHaveBeenCalled();
      expect(await contents("user")).toBe(user);
      expect(await contents("project")).toBe(project);
    },
  );

  it("does not let a broken or untrusted Project file block User writes", async () => {
    await raw("project", "{ invalid");
    expect(
      await commitPresetMutation(ctx, {
        kind: "create",
        scope: "user",
        preset: preset("a"),
      }),
    ).toMatchObject({ ok: true });
    trusted = false;
    expect(
      await commitPresetMutation(ctx, {
        kind: "replace",
        expected: snapshot("a"),
        scope: "user",
        preset: preset("b"),
      }),
    ).toMatchObject({ ok: true });
    expect(await names("user")).toEqual(["b"]);
    expect(await contents("project")).toBe("{ invalid");
  });

  it("refuses project edits/deletes/moves when trust was revoked after taking the snapshot", async () => {
    await saveScope("project", [preset("a")], ctx);

    const original = await contents("project");

    trusted = false;

    for (const mutation of [
      {
        kind: "replace",
        expected: snapshot("a", "project"),
        scope: "project",
        preset: preset("b"),
      },
      { kind: "delete", expected: snapshot("a", "project") },
      {
        kind: "replace",
        expected: snapshot("a", "project"),
        scope: "user",
        preset: preset("b"),
      },
      { kind: "create", scope: "project", preset: preset("b") },
    ] satisfies PresetMutation[]) {
      expect(await commitPresetMutation(ctx, mutation)).toMatchObject({
        ok: false,
        code: "unsafe",
      });
    }

    expect(await contents("project")).toBe(original);
    await expect(stat(path("user"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("checks trust when a queued commit starts, not when it was requested", async () => {
    const entered = createDeferred();
    const release = createDeferred();
    const update = PRESETS_PLUS_CONFIG.update;

    vi.spyOn(PRESETS_PLUS_CONFIG, "update").mockImplementationOnce(
      async (...args) => {
        entered.resolve();
        await release.promise;
        await update(...args);
      },
    );

    const first = commitPresetMutation(ctx, {
      kind: "create",
      scope: "user",
      preset: preset("first"),
    });

    await entered.promise;

    const second = commitPresetMutation(ctx, {
      kind: "create",
      scope: "project",
      preset: preset("second"),
    });

    trusted = false;
    release.resolve();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: false, code: "unsafe" });
    await expect(stat(path("project"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rechecks trust inside the final update callback", async () => {
    const update = PRESETS_PLUS_CONFIG.update;

    vi.spyOn(PRESETS_PLUS_CONFIG, "update").mockImplementationOnce(
      (context, scope, transform) =>
        update(context, scope, (data) => {
          trusted = false;

          return transform(data);
        }),
    );

    expect(
      await commitPresetMutation(ctx, {
        kind: "create",
        scope: "project",
        preset: preset("a"),
      }),
    ).toMatchObject({ ok: false, code: "unsafe" });

    await expect(stat(path("project"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    ["conflict", JSON.stringify({ version: 2, presets: [preset("external")] })],
    ["unsafe", JSON.stringify({ version: 2, showInactiveStatus: "bad" })],
    ["unsafe", "{ invalid"],
    ["unsafe", JSON.stringify({ version: 99 })],
  ])(
    "returns %s instead of overwriting an edit before core's update read",
    async (code, document) => {
      const update = PRESETS_PLUS_CONFIG.update;

      vi.spyOn(PRESETS_PLUS_CONFIG, "update").mockImplementationOnce(
        async (...args) => {
          await raw("user", document);
          await update(...args);
        },
      );

      expect(
        await commitPresetMutation(ctx, {
          kind: "create",
          scope: "user",
          preset: preset("a"),
        }),
      ).toMatchObject({ ok: false, code });
      expect(await contents("user")).toBe(document);
    },
  );

  it("detects an edit between the commit read and the CRUD read", async () => {
    await saveScope("user", [preset("a")], ctx);

    const read = PRESETS_PLUS_CONFIG.read;
    const document = JSON.stringify({
      version: 2,
      presets: [preset("a", { instructions: "external" })],
    });

    vi.spyOn(PRESETS_PLUS_CONFIG, "read").mockImplementationOnce(
      async (...args) => {
        const result = await read(...args);

        await raw("user", document);

        return result;
      },
    );

    expect(
      await commitPresetMutation(ctx, {
        kind: "delete",
        expected: snapshot("a"),
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await contents("user")).toBe(document);
  });
});

describe("move recovery and queue boundaries", () => {
  it("writes the destination first and rolls it back on a source write failure", async () => {
    await saveScope("user", [preset("a")], ctx);
    await raw(
      "project",
      JSON.stringify({
        version: 2,
        unknown: "keep",
        showInactiveStatus: false,
        presets: [preset("b")],
      }),
    );

    const original = JSON.parse(await contents("project")) as unknown;
    const update = PRESETS_PLUS_CONFIG.update;
    const writes: PresetScope[] = [];
    const failure = new Error("source write failed");

    vi.spyOn(PRESETS_PLUS_CONFIG, "update").mockImplementation(
      async (...args) => {
        writes.push(args[1]);

        if (writes.length === 2) throw failure;

        await update(...args);
      },
    );

    await expect(
      commitPresetMutation(ctx, {
        kind: "replace",
        expected: snapshot("a"),
        scope: "project",
        preset: preset("moved"),
      }),
    ).rejects.toBe(failure);
    expect(writes).toEqual(["project", "user", "project"]);
    expect(JSON.parse(await contents("project"))).toEqual(original);
    expect(await names("user")).toEqual(["a"]);
    expect(
      await commitPresetMutation(ctx, {
        kind: "create",
        scope: "user",
        preset: preset("after"),
      }),
    ).toMatchObject({ ok: true });
  });

  it("leaves the source intact on destination failure", async () => {
    await saveScope("user", [preset("a")], ctx);

    const failure = new Error("destination failed");

    vi.spyOn(PRESETS_PLUS_CONFIG, "update").mockRejectedValueOnce(failure);
    await expect(
      commitPresetMutation(ctx, {
        kind: "replace",
        expected: snapshot("a"),
        scope: "project",
        preset: preset("moved"),
      }),
    ).rejects.toBe(failure);
    expect(await names("user")).toEqual(["a"]);
    await expect(stat(path("project"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports both source and rollback errors without poisoning the queue", async () => {
    await saveScope("user", [preset("a")], ctx);

    const update = PRESETS_PLUS_CONFIG.update;
    const sourceError = new Error("source failed");
    const rollbackError = new Error("rollback failed");
    let writes = 0;

    vi.spyOn(PRESETS_PLUS_CONFIG, "update").mockImplementation(
      async (...args) => {
        writes++;

        if (writes === 2) throw sourceError;
        if (writes === 3) throw rollbackError;

        await update(...args);
      },
    );

    await expect(
      commitPresetMutation(ctx, {
        kind: "replace",
        expected: snapshot("a"),
        scope: "project",
        preset: preset("moved"),
      }),
    ).rejects.toMatchObject({ errors: [sourceError, rollbackError] });
    expect(await names("user")).toEqual(["a"]);
    expect(await names("project")).toEqual(["moved"]);
    expect(
      await commitPresetMutation(ctx, {
        kind: "create",
        scope: "user",
        preset: preset("after"),
      }),
    ).toMatchObject({ ok: true });
  });

  it("does not overwrite an external destination edit during rollback", async () => {
    await saveScope("user", [preset("a")], ctx);

    const update = PRESETS_PLUS_CONFIG.update;
    const document = JSON.stringify({
      version: 2,
      presets: [preset("external")],
    });
    const sourceError = new Error("source failed");
    let writes = 0;

    vi.spyOn(PRESETS_PLUS_CONFIG, "update").mockImplementation(
      async (...args) => {
        writes++;

        if (writes === 2) {
          await raw("project", document);

          throw sourceError;
        }

        await update(...args);
      },
    );

    await expect(
      commitPresetMutation(ctx, {
        kind: "replace",
        expected: snapshot("a"),
        scope: "project",
        preset: preset("moved"),
      }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(await contents("project")).toBe(document);
    expect(await names("user")).toEqual(["a"]);
  });

  it("continues an already queued commit after an unexpected failure", async () => {
    const failure = new Error("disk failed");

    vi.spyOn(PRESETS_PLUS_CONFIG, "update").mockRejectedValueOnce(failure);

    const first = commitPresetMutation(ctx, {
      kind: "create",
      scope: "user",
      preset: preset("first"),
    });
    const rejected = expect(first).rejects.toBe(failure);
    const second = commitPresetMutation(ctx, {
      kind: "create",
      scope: "user",
      preset: preset("second"),
    });

    await rejected;
    expect(await second).toMatchObject({ ok: true });
    expect(await names("user")).toEqual(["second"]);
  });

  it("freezes queued draft values rather than retaining mutable caller arrays", async () => {
    const candidate = preset("a", { tools: ["read"] });
    const result = commitPresetMutation(ctx, {
      kind: "create",
      scope: "user",
      preset: candidate,
    });

    candidate.name = "changed";
    candidate.tools?.push("bash");
    expect(await result).toEqual({
      ok: true,
      changed: true,
      saved: snapshot("a", "user", { tools: ["read"] }),
    });
    expect(await names("user")).toEqual(["a"]);
  });
});
