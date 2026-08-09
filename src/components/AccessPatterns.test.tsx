// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccessPatterns } from "./AccessPatterns";
import { fold } from "../engine/engine";
import { parseDoc } from "../model/dsl";
import { BASE_INDEX } from "../model/seed";

// One served pattern (an item matches its GSI query) and one dangling one.
const DSL = `@table T pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK
@ap Find a user by email -> GSI1 GSI1PK=EMAIL#a
@ap A dangling pattern
u1: PK=USER#1  SK=PROFILE  GSI1PK=EMAIL#a  GSI1SK=USER#1`;

function setup(over: Partial<Parameters<typeof AccessPatterns>[0]> = {}) {
  const parsed = parseDoc(DSL, BASE_INDEX);
  const state = fold(parsed.ops, parsed.base);
  const props = {
    open: true,
    aps: parsed.aps,
    base: parsed.base,
    gsis: parsed.gsis,
    state,
    onClose: vi.fn(),
    ...over,
  };
  render(<AccessPatterns {...props} />);
  return props;
}

describe("AccessPatterns", () => {
  it("summarizes served vs unserved counts in the header", () => {
    setup();
    expect(screen.getByText("1/2 served")).toBeInTheDocument();
    expect(screen.getByText("1 unserved")).toBeInTheDocument();
  });

  it("lists each pattern with its number and description", () => {
    setup();
    expect(screen.getByText("AP1")).toBeInTheDocument();
    expect(screen.getByText("Find a user by email")).toBeInTheDocument();
    expect(screen.getByText("AP2")).toBeInTheDocument();
    expect(screen.getByText("A dangling pattern")).toBeInTheDocument();
  });

  it("closes from the drawer button", () => {
    const p = setup();
    fireEvent.click(screen.getByTitle("close"));
    expect(p.onClose).toHaveBeenCalledOnce();
  });
});
