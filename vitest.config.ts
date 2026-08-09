import { defineConfig } from "vitest/config";

// Test-only config, separate from vite.config.ts so the app build never pulls
// in Vitest types. The pure engine/model tests run in the default node
// environment and need no plugins, which also sidesteps the dual-Vite type
// clash you get from adding a `test` block to a plugin'd Vite config.
//
// `npm run coverage` writes coverage/lcov.info, which CI uploads to Codecov.
export default defineConfig({
  test: {
    // Registers jest-dom matchers + after-each cleanup. Individual UI test
    // files opt into jsdom with a `// @vitest-environment jsdom` docblock; the
    // engine/model tests stay in the faster default node environment.
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      // `text` for the CI log, `lcov` for the report Codecov ingests.
      reporter: ["text", "lcov"],
      // Coverage measures the code we actually unit-test: the engine and model
      // logic, every hook, and every component EXCEPT the two that aren't
      // unit-coverable — App.tsx (the composition shell, guarded by a smoke
      // test) and Editor.tsx (CodeMirror wiring; its handle is covered by
      // Editor.test.tsx and its completion logic lives in editorCompletions).
      include: [
        "src/engine/**/*.ts",
        "src/model/**/*.ts",
        "src/hooks/**/*.ts",
        "src/components/**",
      ],
      // Test files aren't measured; seed/tours are curated data literals; App
      // and Editor are excluded per the note above (not unit-coverable).
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/model/seed.ts",
        "src/model/tours.ts",
        "src/App.tsx",
        "src/components/Editor.tsx",
      ],
    },
  },
});
