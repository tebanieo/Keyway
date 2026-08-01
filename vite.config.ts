import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vitest reads this config too; its default environment (node) is all the pure
// engine tests need, so there's no `test` block here.
//
// `base: "./"` makes asset paths relative so the built app works when served
// from a subpath (e.g. GitHub Pages project sites at /repo-name/) without
// knowing the repo name. It's a single-page app with no router, so relative
// paths are safe.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
