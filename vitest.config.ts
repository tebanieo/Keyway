import { defineConfig } from "vitest/config";

// Test-only config, separate from vite.config.ts so the app build never pulls
// in Vitest types. The pure engine/model tests run in the default node
// environment and need no plugins, which also sidesteps the dual-Vite type
// clash you get from adding a `test` block to a plugin'd Vite config.
//
// `npm run coverage` writes coverage/lcov.info, which CI uploads to Codecov.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // `text` for the CI log, `lcov` for the report Codecov ingests.
      reporter: ["text", "lcov"],
      // Measure the engine/source, not tests or generated/entry files.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/vite-env.d.ts"],
    },
  },
});
