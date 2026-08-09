// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostBar } from "./CostBar";
import type { OpCost } from "../engine/cost";

const base: OpCost = {
  base: "put",
  baseWrites: 1,
  indexes: [],
  transactional: false,
  totalWrites: 1,
};

describe("CostBar", () => {
  it("shows the idle message with no cost", () => {
    render(<CostBar cost={null} bytes={0} />);
    expect(screen.getByText(/empty table/)).toBeInTheDocument();
  });

  it("renders a rejected write with its billed WCU", () => {
    const { container } = render(<CostBar cost={{ ...base, rejected: true }} bytes={0} />);
    expect(container.querySelector(".costbar.rejected")).not.toBeNull();
    expect(screen.getByText(/condition not met/)).toBeInTheDocument();
    expect(screen.getByText(/billed for the attempt/)).toBeInTheDocument();
  });

  it("renders total, item bytes, and per-index effects", () => {
    const cost: OpCost = {
      ...base,
      totalWrites: 3,
      indexes: [{ index: "GSI1", effect: "reindex", writes: 2, from: "A", to: "B" }],
    };
    render(<CostBar cost={cost} bytes={42} />);
    expect(screen.getByText("WCU")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument(); // item bytes
    expect(screen.getByText("GSI1")).toBeInTheDocument();
    expect(screen.getByText("reindex")).toBeInTheDocument(); // EFFECT_WORD
    expect(screen.getByText("A")).toBeInTheDocument(); // from
    expect(screen.getByText("B")).toBeInTheDocument(); // to
  });

  it("marks a transactional write with a TX badge", () => {
    render(<CostBar cost={{ ...base, transactional: true }} bytes={0} />);
    expect(screen.getByText(/TX/)).toBeInTheDocument();
  });

  it("omits the item-bytes chip when bytes is 0", () => {
    const { container } = render(<CostBar cost={base} bytes={0} />);
    expect(container.querySelector(".item-bytes")).toBeNull();
  });
});
