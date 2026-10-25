/** Run the standalone extension tests in Node with explicit test API imports. */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    ...(process.env.CI && { testTimeout: 30_000 }),
    ...(process.env.GITHUB_ACTIONS === "true" && {
      reporters: [
        "default",
        ["github-actions", { jobSummary: { enabled: false } }],
      ],
    }),
  },
});
