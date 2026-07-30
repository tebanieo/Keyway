import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vitest reads this config too; its default environment (node) is all the pure
// engine tests need, so there's no `test` block here.
export default defineConfig({
  plugins: [react()],
});
