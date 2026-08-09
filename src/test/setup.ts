// Global test setup. Registers jest-dom's DOM matchers (toBeInTheDocument,
// etc.) and unmounts anything a test rendered after each case. Runs for every
// test file; the pure engine/model tests just don't render anything, so the
// afterEach cleanup is a no-op for them.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());
