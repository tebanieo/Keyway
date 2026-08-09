// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlaybackHud } from "./PlaybackHud";
import type { OpCost } from "../engine/cost";

const cost: OpCost = {
  base: "put",
  baseWrites: 1,
  indexes: [],
  transactional: false,
  totalWrites: 1,
};

describe("PlaybackHud", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(
      <PlaybackHud visible={false} narration="hi" curStep={1} cost={cost} opBytes={10} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows narration with the step number when visible", () => {
    render(
      <PlaybackHud
        visible={true}
        narration="ada follows alan"
        curStep={3}
        cost={null}
        opBytes={0}
      />,
    );
    expect(screen.getByText("ada follows alan")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("omits the narration block when there is no narration", () => {
    const { container } = render(
      <PlaybackHud visible={true} narration={undefined} curStep={2} cost={cost} opBytes={5} />,
    );
    expect(container.querySelector(".narration")).toBeNull();
  });

  it("renders the cost bar when a cost is present", () => {
    const { container } = render(
      <PlaybackHud visible={true} narration={undefined} curStep={1} cost={cost} opBytes={20} />,
    );
    expect(container.querySelector(".cost-hud")).not.toBeNull();
    expect(screen.getByText("WCU")).toBeInTheDocument();
  });

  it("marks the narration rejected when the write was rejected", () => {
    const { container } = render(
      <PlaybackHud
        visible={true}
        narration="blocked"
        curStep={1}
        cost={{ ...cost, rejected: true }}
        opBytes={0}
      />,
    );
    expect(container.querySelector(".narration.rejected")).not.toBeNull();
  });
});
