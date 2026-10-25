/**
 * Commit UI-independent preset mutations against fresh, safe scope files.
 * Only these commits share the process-local queue; legacy CRUD callers and
 * external processes do not. Write callbacks detect intervening edits where
 * possible, but do not provide a cross-process transaction or lock.
 */
import { isDeepStrictEqual } from "node:util";

import { diagnoseDraftHotkey } from "../hotkey-rules.js";
import type { PresetIdentity } from "../preset-identity.js";
import type { Preset, PresetScope, ScopeConfig } from "../types.js";
import {
  addPreset,
  movePreset,
  readScope,
  removePreset,
  reorderWithinScope,
  StorageWriteError,
  toPersistedPreset,
  updatePreset,
  type SaveResult,
  type ScopePrecondition,
  type StorageContext,
} from "./api.js";
import { validatePresetShape } from "./validate.js";

/** A preset and the exact scope-qualified identity originally read. */
export interface PresetSnapshot {
  readonly identity: PresetIdentity;
  readonly preset: Preset;
}

/** A requested change with optimistic preconditions for existing entries. */
export type PresetMutation =
  | { kind: "create"; scope: PresetScope; preset: Preset }
  | {
      kind: "replace";
      expected: PresetSnapshot;
      scope: PresetScope;
      preset: Preset;
    }
  | { kind: "delete"; expected: PresetSnapshot }
  | {
      kind: "reorder";
      scope: PresetScope;
      expectedNames: readonly string[];
      orderedNames: readonly string[];
    };

/** A successful commit or an expected, non-destructive refusal. */
export type PresetMutationResult =
  | { ok: true; changed: boolean; saved?: PresetSnapshot }
  | {
      ok: false;
      code: "conflict" | "collision" | "unsafe" | "invalid";
      reason: string;
    };

let commitTail: Promise<void> = Promise.resolve();

/** Serialize a fresh validation and commit without holding any UI interaction. */
export function commitPresetMutation(
  ctx: StorageContext,
  mutation: PresetMutation,
): Promise<PresetMutationResult> {
  const request = structuredClone(mutation);
  const result = commitTail.then(() => commit(ctx, request));

  // Rejections reach the caller, but must never poison later commits.
  commitTail = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
}

async function commit(
  ctx: StorageContext,
  mutation: PresetMutation,
): Promise<PresetMutationResult> {
  const invalid = validateMutation(mutation);

  if (invalid) return { ok: false, code: "invalid", reason: invalid };

  const scopes = new Set<PresetScope>([
    mutation.kind === "delete"
      ? mutation.expected.identity.scope
      : mutation.scope,
  ]);

  if (mutation.kind === "replace") scopes.add(mutation.expected.identity.scope);

  const loaded = new Map<PresetScope, ScopeConfig>();

  for (const scope of scopes) {
    const result = await readScope(scope, ctx);

    if ("ok" in result) return { ...result, code: "unsafe" };

    loaded.set(scope, result);
  }

  const getScope = (scope: PresetScope): ScopeConfig => {
    const result = loaded.get(scope);

    if (!result) throw new Error(`Missing mutation scope: ${scope}.`);

    return result;
  };
  const check: ScopePrecondition = (scope, fresh) => {
    if (!isDeepStrictEqual(fresh.document, getScope(scope).document)) {
      throw new StorageWriteError(
        "conflict",
        "The configuration changed before it could be saved. Reload and try again.",
      );
    }
  };

  if (mutation.kind === "replace" || mutation.kind === "delete") {
    const expected = mutation.expected;
    const fresh = getScope(expected.identity.scope).presets.find(
      (preset) => preset.name === expected.identity.name,
    );

    if (!fresh || !samePreset(fresh, expected.preset)) {
      return {
        ok: false,
        code: "conflict",
        reason: "The preset changed or was deleted. Reload and try again.",
      };
    }
  }

  if (mutation.kind === "create" || mutation.kind === "replace") {
    const collision = getScope(mutation.scope).presets.some(
      (preset) =>
        preset.name === mutation.preset.name &&
        !(
          mutation.kind === "replace" &&
          mutation.expected.identity.scope === mutation.scope &&
          mutation.expected.identity.name === preset.name
        ),
    );

    if (collision) {
      return {
        ok: false,
        code: "collision",
        reason: `A preset named "${mutation.preset.name}" already exists in scope "${mutation.scope}".`,
      };
    }

    if (
      mutation.kind === "replace" &&
      mutation.scope === mutation.expected.identity.scope &&
      samePreset(mutation.preset, mutation.expected.preset)
    ) {
      return {
        ok: true,
        changed: false,
        saved: snapshot(mutation.scope, mutation.preset),
      };
    }
  }

  if (mutation.kind === "reorder") {
    const names = getScope(mutation.scope).presets.map((preset) => preset.name);

    if (!isDeepStrictEqual(names, mutation.expectedNames)) {
      return {
        ok: false,
        code: "conflict",
        reason: "The preset list changed. Reload and try again.",
      };
    }

    if (isDeepStrictEqual(names, mutation.orderedNames))
      return { ok: true, changed: false };
  }

  try {
    let result: SaveResult;

    switch (mutation.kind) {
      case "create":
        result = await addPreset(mutation.preset, mutation.scope, ctx, check);

        break;

      case "replace": {
        const { name, scope } = mutation.expected.identity;

        result =
          scope === mutation.scope
            ? await updatePreset(name, scope, mutation.preset, ctx, check)
            : await movePreset(
                name,
                scope,
                mutation.scope,
                mutation.preset,
                ctx,
                undefined,
                check,
              );

        break;
      }

      case "delete":
        result = await removePreset(
          mutation.expected.identity.name,
          mutation.expected.identity.scope,
          ctx,
          check,
        );

        break;
      case "reorder":
        result = await reorderWithinScope(
          mutation.scope,
          mutation.orderedNames,
          ctx,
          check,
        );

        break;
    }

    if (!result.ok) {
      // The legacy API can refuse after its own fresh read. Classify safety
      // without matching human-readable error messages.
      for (const scope of scopes) {
        if ("ok" in (await readScope(scope, ctx)))
          return { ...result, code: "unsafe" };
      }

      return { ...result, code: "conflict" };
    }

    return mutation.kind === "create" || mutation.kind === "replace"
      ? {
          ok: true,
          changed: true,
          saved: snapshot(mutation.scope, mutation.preset),
        }
      : { ok: true, changed: true };
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return { ok: false, code: error.code, reason: error.message };
    }

    // Core may refuse invalid JSON/version or revoked trust before invoking
    // our update callback. Preserve unexpected I/O and rollback errors.
    if (!(error instanceof AggregateError)) {
      for (const scope of scopes) {
        const fresh = await readScope(scope, ctx);

        if ("ok" in fresh) return { ...fresh, code: "unsafe" };
      }
    }

    throw error;
  }
}

function samePreset(first: Preset, second: Preset): boolean {
  return isDeepStrictEqual(toPersistedPreset(first), toPersistedPreset(second));
}

function snapshot(scope: PresetScope, preset: Preset): PresetSnapshot {
  return {
    identity: { scope, name: preset.name },
    preset: toPersistedPreset(preset),
  };
}

function validateMutation(mutation: PresetMutation): string | undefined {
  if (
    mutation.kind !== "delete" &&
    mutation.scope !== "user" &&
    mutation.scope !== "project"
  ) {
    return "Invalid preset scope.";
  }

  if (mutation.kind === "replace" || mutation.kind === "delete") {
    const { identity, preset } = mutation.expected;
    const shape = validatePresetShape(preset);

    if (!shape.ok) return shape.reason ?? "Invalid expected preset.";

    if (
      (identity.scope !== "user" && identity.scope !== "project") ||
      identity.name !== preset.name
    ) {
      return "The expected preset identity does not match its snapshot.";
    }
  }

  if (mutation.kind === "create" || mutation.kind === "replace") {
    const shape = validatePresetShape(mutation.preset);

    if (!shape.ok) return shape.reason ?? "Invalid preset.";

    const diagnostic = diagnoseDraftHotkey(
      {
        scope: mutation.scope,
        name: mutation.preset.name,
        hotkey: mutation.preset.hotkey ?? "",
      },
      [],
    );

    if (diagnostic?.severity === "error") return diagnostic.message;
  }

  if (mutation.kind === "reorder") {
    const { expectedNames, orderedNames } = mutation;

    if (
      ![expectedNames, orderedNames].every(
        (names) =>
          Array.isArray(names) &&
          names.every((name) => typeof name === "string" && name.length > 0) &&
          new Set(names).size === names.length,
      ) ||
      expectedNames.length !== orderedNames.length ||
      orderedNames.some((name) => !expectedNames.includes(name))
    ) {
      return "The new order must contain each expected preset name exactly once.";
    }
  }

  return undefined;
}
