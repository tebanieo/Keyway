// Loads the ExtendDB WASM once for every test file. Node can't fetch() a
// file:// URL (and jsdom rewrites import.meta.url), so the bytes are read from
// disk relative to the project root, where Vitest runs. Plain JS so `src`
// stays free of Node types.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initExtendDB } from "../engine/extenddb";

await initExtendDB(readFileSync(resolve(process.cwd(), "wasm/pkg/keyway_extenddb_bg.wasm")));
