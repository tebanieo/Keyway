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
      // logic, every hook, and the presentational components listed here.
      // App.tsx (the composition shell) and the CodeMirror-heavy Editor are not
      // unit-tested, so they stay out to keep the number honest.
      include: [
        "src/engine/**/*.ts",
        "src/model/**/*.ts",
        "src/hooks/**/*.ts",
        "src/components/AppChrome.tsx",
        "src/components/BackfillBanner.tsx",
        "src/components/PanesBar.tsx",
        "src/components/PlaybackHud.tsx",
        "src/components/PanesGrid.tsx",
        // The editor's pure completion engine, extracted from the CodeMirror
        // wiring in Editor.tsx (which stays out — its handle is exercised by
        // Editor.test.tsx, but the view plumbing isn't unit-coverable).
        "src/components/editorCompletions.ts",
      ],
      // Within model, these are curated content/data, not logic — there's
      // nothing meaningful to unit-test in a literal.
      exclude: ["src/**/*.test.{ts,tsx}", "src/model/seed.ts", "src/model/tours.ts"],
    },
  },
});
