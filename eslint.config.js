import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * Flat ESLint config for the app. Type-aware linting is intentionally OFF for
 * speed (tsc -b already type-checks in the same pre-commit run); this catches
 * the things the compiler doesn't: hooks rules, unused vars, dead code.
 */
export default tseslint.config(
  {
    ignores: ["dist", "docs/.vitepress/dist", "docs/.vitepress/cache", "coverage"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Allow intentionally-unused args/vars when prefixed with `_`.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Config + Node-side files run in Node, not the browser.
  {
    files: ["*.config.{js,ts}", "docs/.vitepress/**/*.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
