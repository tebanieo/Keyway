import { defineConfig } from "vitepress";

// Keyway reference manual — the "what/how" lookup that ships alongside the app.
//
// IMPORTANT — base path for GitHub Pages:
//   The app is served at the Pages root and this manual is copied into
//   `dist/docs` by the deploy workflow, so the docs live at `<site>/docs/`.
//   • On a USER/ORG Pages site (https://<user>.github.io) the site root IS the
//     origin, so `base: "/docs/"` (below) is already correct.
//   • On a PROJECT Pages site (https://<user>.github.io/<repo>/) the whole site
//     is served under `/<repo>/`, so the manual lives at `/<repo>/docs/`. In
//     that case change the line below to:  base: "/<repo-name>/docs/"
//   Set this ONCE, when the repository name is known. Everything else works as-is.
export default defineConfig({
  base: "/docs/",
  title: "Keyway",
  description: "Reference for the single-table data modeler",
  // Leave outDir at the VitePress default (docs/.vitepress/dist). The deploy
  // workflow copies that into the app's dist/docs — we never write into dist/ here.
  lastUpdated: true,
  cleanUrls: true,
  // CODE_REVIEW.md is an internal review note that happens to live in docs/ —
  // it's not part of the published manual, so keep it out of the built site.
  srcExclude: ["CODE_REVIEW.md"],
  themeConfig: {
    nav: [
      { text: "Manual", link: "/dsl" },
      // Link back to the app. Relative "../" resolves from `<site>/docs/` up to
      // the app at the site root, on localhost and GitHub Pages alike.
      { text: "Open the app ↗", link: "../" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [{ text: "What Keyway is", link: "/" }],
      },
      {
        text: "Authoring",
        items: [
          { text: "The DSL", link: "/dsl" },
          { text: "Editor & autocomplete", link: "/editor" },
        ],
      },
      {
        text: "Reading & reasoning",
        items: [
          { text: "Filters & query conditions", link: "/filters" },
          { text: "The cost model", link: "/cost" },
          { text: "Access-pattern coverage", link: "/access-patterns" },
        ],
      },
      {
        text: "Sharing",
        items: [{ text: "Share links & examples", link: "/sharing" }],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: "local" },
    socialLinks: [],
  },
});
