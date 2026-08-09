// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { App } from "./App";

// Analytics is a fire-and-forget side effect; stub it so the smoke test doesn't
// depend on network/localhost behavior.
vi.mock("./analytics", () => ({ track: vi.fn(), trackItem: vi.fn() }));

// A mount-and-wire smoke test for the composition shell. App.tsx isn't in the
// coverage include (it's integration, not unit), but this guards against the
// whole tree failing to render or the drawer/hook wiring breaking. It stays in
// canvas mode throughout, so the CodeMirror editor is never mounted.
const drawerByTitle = (title: string) =>
  screen.getByText(title, { selector: ".drawer-title" }).closest(".drawer")!;

describe("App (smoke)", () => {
  it("mounts with the footer and the rail buttons", () => {
    render(<App />);
    expect(screen.getByText(/Opinions are my own/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Examples/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Learn/ })).toBeInTheDocument();
  });

  it("opens a rail drawer, and only one is open at a time", () => {
    render(<App />);
    const examples = drawerByTitle("Examples");
    const learn = drawerByTitle("Learn");

    fireEvent.click(screen.getByRole("button", { name: /Examples/ }));
    expect(examples).toHaveClass("open");
    expect(learn).not.toHaveClass("open");

    fireEvent.click(screen.getByRole("button", { name: /Learn/ }));
    expect(examples).not.toHaveClass("open");
    expect(learn).toHaveClass("open");
  });

  it("dismisses the open drawer on an outside click", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Examples/ }));
    const examples = drawerByTitle("Examples");
    expect(examples).toHaveClass("open");

    fireEvent.mouseDown(document.body);
    expect(examples).not.toHaveClass("open");
  });
});
