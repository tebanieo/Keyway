// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon, Logo } from "./icons";

const NAMES = [
  "play",
  "pause",
  "prev",
  "next",
  "patterns",
  "examples",
  "theme",
  "query",
  "learn",
  "docs",
] as const;

describe("icons", () => {
  it("renders an svg for every icon name", () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("renders the Keyway logo", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
