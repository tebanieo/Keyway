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
      // Coverage is scoped to the pure logic we actually unit-test: the engine
      // and the model. The React UI (components, hooks, App, main) has no
      // component tests yet, so including it would report a misleading number
      // over code these tests were never meant to cover. Revisit when UI tests
      // land (App.tsx and the useModel hook especially).
      include: ["src/engine/**/*.ts", "src/model/**/*.ts"],
      // Within model, these are curated content/data, not logic — there's
      // nothing meaningful to unit-test in a literal.
      exclude: ["src/**/*.test.{ts,tsx}", "src/model/seed.ts", "src/model/tours.ts"],
    },
  },
});
