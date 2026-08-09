// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppHint, AppFooter, CopiedToast } from "./AppChrome";

describe("AppHint", () => {
  it("shows editor guidance in editing mode", () => {
    render(<AppHint editing={true} />);
    expect(screen.getByText(/scaffolds a row/)).toBeInTheDocument();
    expect(screen.getByText(/GSI2PK/)).toBeInTheDocument();
  });

  it("shows canvas guidance otherwise", () => {
    render(<AppHint editing={false} />);
    expect(screen.getByText(/Double-click a base cell/)).toBeInTheDocument();
  });
});

describe("AppFooter", () => {
  it("renders the disclaimer and a Source link to the repo", () => {
    render(<AppFooter />);
    expect(screen.getByText(/Opinions are my own/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://github.com/tebanieo/Keyway",
    );
  });
});

describe("CopiedToast", () => {
  it("renders nothing when there is no value", () => {
    const { container } = render(<CopiedToast value={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the copied value", () => {
    render(<CopiedToast value="USER#1" />);
    expect(screen.getByText("USER#1")).toBeInTheDocument();
    expect(screen.getByText(/copied/)).toBeInTheDocument();
  });
});
