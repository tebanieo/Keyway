import { defineConfig } from "vitepress";

// Keyway reference manual: the "what/how" lookup that ships alongside the app.
//
// Base path for GitHub Pages:
//   The app is served at the Pages root and this manual is copied into
//   `dist/docs` by the deploy workflow, so the docs live at `<site>/docs/`.
//   This is a PROJECT Pages site (repo "Keyway"), served under `/Keyway/`, so
//   the manual lives at `/Keyway/docs/`. If the repo is ever renamed, or moved
//   to a user/org Pages site (https://<user>.github.io, root = origin), update
//   this to `/<repo>/docs/` or `/docs/` respectively.
export default defineConfig({
  base: "/Keyway/docs/",
  title: "Keyway",
  description: "Reference for Keyway, a DynamoDB data modeling tool",
  // Favicon (served from docs/public/). head links aren't base-rewritten, so the
  // href carries the full base path; update it if the repo/base ever changes.
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/Keyway/docs/favicon.svg" }]],
  // Leave outDir at the VitePress default (docs/.vitepress/dist). The deploy
  // workflow copies that into the app's dist/docs; we never write into dist/ here.
  lastUpdated: true,
  cleanUrls: true,
  // CODE_REVIEW.md is an internal review note that happens to live in docs/.
  // It's not part of the published manual, so keep it out of the built site.
  srcExclude: ["CODE_REVIEW.md"],
  themeConfig: {
    // Small logo next to the "Keyway" title in the navbar (top-left).
    logo: "/favicon.svg",
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
    footer: {
      message:
        "A personal project. Opinions are my own, not those of AWS or Amazon. Amazon DynamoDB, AWS, and NoSQL Workbench are trademarks of Amazon.com, Inc. or its affiliates.",
      copyright: "MIT-licensed. Copyright © 2026 Esteban Serna.",
    },
  },
});
