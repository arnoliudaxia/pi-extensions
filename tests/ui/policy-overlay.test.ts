/**
 * Covers the policy override confirmation: the title, the body naming the
 * preset, the button labels the user chooses between, and Pi's own confirm
 * prompt outside the TUI, where no overlay can open.
 */
import { createFakeContext } from "../support/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openConfirmMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/ui/confirm.js", () => ({ openConfirm: openConfirmMock }));

const { openPolicyOverride } = await import("../../src/ui/policy-overlay.js");

beforeEach(() => {
  openConfirmMock.mockReset();
  openConfirmMock.mockResolvedValue(false);
});

describe("openPolicyOverride", () => {
  it("names the preset and offers Override and Cancel", async () => {
    const ctx = { mode: "tui", ui: {} } as Parameters<
      typeof openPolicyOverride
    >[0];

    await openPolicyOverride(ctx, { name: "personal-opus" });

    expect(openConfirmMock).toHaveBeenCalledWith(
      ctx,
      "Preset Doesn't Match Policy",
      expect.stringContaining('preset "personal-opus"'),
      { no: "Cancel", yes: "Override" },
    );
  });

  it("keeps the real TUI mode while using a requested standard confirmation", async () => {
    const confirm = vi.fn(() => Promise.resolve(true));
    const ctx = createFakeContext({ mode: "tui", ui: { confirm } });

    await expect(
      openPolicyOverride(ctx, { name: "personal-opus" }, { standard: true }),
    ).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      "Preset Doesn't Match Policy",
      'The access policy for this directory does not permit preset "personal-opus". Activate it anyway?',
    );
    expect(ctx.mode).toBe("tui");
    expect(openConfirmMock).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "asks through Pi's confirm prompt in RPC mode and returns %s",
    async (answer) => {
      const asked: [string, string][] = [];
      const ctx = {
        mode: "rpc",
        ui: {
          confirm: (title: string, message: string) => {
            asked.push([title, message]);

            return Promise.resolve(answer);
          },
        },
      } as Parameters<typeof openPolicyOverride>[0];

      await expect(
        openPolicyOverride(ctx, { name: "personal-opus" }),
      ).resolves.toBe(answer);

      expect(asked).toEqual([
        [
          "Preset Doesn't Match Policy",
          expect.stringContaining('preset "personal-opus"'),
        ],
      ]);
      expect(openConfirmMock).not.toHaveBeenCalled();
    },
  );
});
