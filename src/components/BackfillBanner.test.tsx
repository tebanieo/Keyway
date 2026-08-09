// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackfillBanner } from "./BackfillBanner";
import type { Backfill } from "../model/backfill";

const backfill: Backfill = {
  attr: "discount",
  type: "order",
  value: "0",
  targets: [
    { id: "o1", attrs: {} },
    { id: "o2", attrs: {} },
  ],
};

describe("BackfillBanner", () => {
  it("names the attribute, entity type, and target count", () => {
    render(<BackfillBanner backfill={backfill} onApply={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("discount")).toBeInTheDocument();
    expect(screen.getByText("order")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /backfill 2/ })).toBeInTheDocument();
  });

  it("fires onApply and onDismiss from the buttons", () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    render(<BackfillBanner backfill={backfill} onApply={onApply} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /backfill 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
