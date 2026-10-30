/** Check lossless draft previews, safe display text, and stable menu identities. */
import { buildRpcMenu } from "../../src/ui/editor/rpc-menu.js";
import type { RpcPresetDraft } from "../../src/ui/rpc-editor-types.js";
import { describe, expect, it } from "vitest";

const DRAFT: RpcPresetDraft = {
  scope: "user",
  preset: { name: "name", provider: "provider", model: "model" },
};

function rows(draft: RpcPresetDraft = DRAFT): string[] {
  return [...buildRpcMenu(draft, true).keys()];
}

describe("RPC menu previews", () => {
  it("omits terminal-only choices by default without changing the draft", () => {
    const draft = {
      ...DRAFT,
      preset: { ...DRAFT.preset, hotkey: "ctrl+shift+1", order: 0 },
    };
    const menu = buildRpcMenu(draft);

    expect([...menu.values()]).not.toContain("hotkey");
    expect([...menu.keys()].some((row) => row.startsWith("Hotkey:"))).toBe(
      false,
    );
    expect(draft.preset.hotkey).toBe("ctrl+shift+1");
    expect([...menu.values()]).not.toContain("order");
    expect([...menu.keys()].some((row) => row.startsWith("Order:"))).toBe(
      false,
    );
    expect(draft.preset.order).toBe(0);
    expect([...buildRpcMenu(draft, true).values()]).toContain("hotkey");
    expect([...buildRpcMenu(draft, true).keys()]).toContain("Order: 0");
  });

  it("shows every field, omitted values, and unchanged action labels", () => {
    expect(rows()).toEqual([
      "Name: name",
      "Scope: User",
      "Provider: provider",
      "Model: model",
      "Thinking level: Default (Off)",
      "Tools: Inherit (omitted)",
      "Prompt: (Unset)",
      "Hotkey: (Unset)",
      "Order: (Unset)",
      "Save",
      "Save And Apply",
      "Cancel",
    ]);
    expect(rows({ ...DRAFT, scope: "project" })).toContain("Scope: Project");
  });

  it("distinguishes empty, whitespace-only, zero, off, and inherited empty tools", () => {
    const draft: RpcPresetDraft = {
      ...DRAFT,
      preset: {
        name: "",
        provider: "",
        model: "",
        instructions: "",
        hotkey: " \t ",
        thinkingLevel: "off",
        tools: [],
        order: 0,
      },
    };

    expect(rows(draft)).toEqual([
      "Name: (Empty)",
      "Scope: User",
      "Provider: (Empty)",
      "Model: (Empty)",
      "Thinking level: Off",
      "Tools: Inherit ([]: empty list)",
      "Prompt: (Empty)",
      "Hotkey: (Whitespace only)",
      "Order: 0",
      "Save",
      "Save And Apply",
      "Cancel",
    ]);

    expect(
      rows({ ...DRAFT, preset: { ...DRAFT.preset, hotkey: "" } }),
    ).toContain("Hotkey: (Empty)");
  });

  it("previews explicit tool lists including unknown names without filtering", () => {
    const draft: RpcPresetDraft = {
      ...DRAFT,
      preset: { ...DRAFT.preset, tools: ["read", "unknown:tool", "工具😀"] },
    };

    expect(rows(draft)).toContain(
      'Tools: \\["read","unknown:tool","工具😀"\\]',
    );
    expect(draft.preset.tools).toEqual(["read", "unknown:tool", "工具😀"]);
  });

  it("maps full display strings with colons to stable fields and never old labels", () => {
    const menu = buildRpcMenu({
      ...DRAFT,
      preset: {
        ...DRAFT.preset,
        name: "Name: Save: Cancel",
        provider: "https://provider:8080",
        model: "model:variant",
        instructions: "Prompt: value: more",
      },
    });

    expect(menu.get("Name: Name: Save: Cancel")).toBe("name");
    expect(menu.get("Provider: https://provider:8080")).toBe("provider");
    expect(menu.get("Model: model:variant")).toBe("model");
    expect(menu.get("Prompt: Prompt: value: more")).toBe("instructions");
    expect(menu.get("Name")).toBeUndefined();
    expect(menu.get("Prompt")).toBeUndefined();
    expect(menu.get("Save")).toBe("save");
    expect(menu.get("Save And Apply")).toBe("save-apply");
    expect(menu.get("Cancel")).toBe("cancel");
  });

  it("folds multiline Chinese and emoji prompts while preserving all source whitespace", () => {
    const instructions = ` \n\t中文😀  第一行\r\n第二行\u2028${"长文👩‍💻".repeat(40)}\n\n `;
    const draft: RpcPresetDraft = {
      ...DRAFT,
      preset: { ...DRAFT.preset, instructions },
    };
    const before = structuredClone(draft);
    const prompt = rows(draft).find((row) => row.startsWith("Prompt: "));

    expect(prompt).toMatch(/^Prompt: 中文😀 第一行 第二行 长文👩‍💻/u);
    expect(prompt).toMatch(/…$/u);
    expect(prompt).not.toMatch(/[\r\n\t\u2028\u2029]/u);
    expect(prompt?.length).toBeLessThan(160);
    expect(draft).toStrictEqual(before);
  });

  it.each(["😀", "👩‍💻", "🇨🇳", "e\u0301"])(
    "truncates whole graphemes at the preview boundary for %s",
    (grapheme) => {
      const instructions = `${"中".repeat(58)}${grapheme}之后更多`;
      const prompt = rows({
        ...DRAFT,
        preset: { ...DRAFT.preset, instructions },
      }).find((row) => row.startsWith("Prompt: "));

      expect(prompt).toBe(`Prompt: ${"中".repeat(58)}${grapheme}…`);
    },
  );

  it("bounds all free-text previews, not just prompts", () => {
    const long = "长😀".repeat(100);
    const menu = buildRpcMenu({
      ...DRAFT,
      preset: {
        name: long,
        provider: long,
        model: long,
        instructions: long,
        hotkey: long,
        tools: [long],
      },
    });

    for (const [row, field] of menu) {
      if (
        [
          "scope",
          "thinkingLevel",
          "order",
          "save",
          "save-apply",
          "cancel",
        ].includes(field)
      )
        continue;
      expect(row).toMatch(/…$/u);
      expect(row.length).toBeLessThan(130);
    }
  });

  it("removes ANSI and controls and escapes value Markdown without mutating the draft", () => {
    const unsafe =
      "\u001b[31m**bold**\u001b[0m [link](https://bad) `code` <img> &copy;\u0000\u0007\nnext\u202e";
    const draft: RpcPresetDraft = {
      ...DRAFT,
      preset: { ...DRAFT.preset, name: unsafe, instructions: unsafe },
    };
    const before = structuredClone(draft);
    const menu = rows(draft);
    const name = menu[0];

    expect(name).toContain("\\*\\*bold\\*\\*");
    expect(name).toContain("\\[link\\](https://bad)");
    expect(name).toContain("\\`code\\`");
    expect(name).toContain("\\<img\\>");
    expect(name).toContain("&amp;copy;");

    for (const row of menu) {
      expect(row).not.toMatch(/[\p{Cc}\u2028\u2029\u202e]/u);
    }

    expect(draft).toStrictEqual(before);
  });
});
