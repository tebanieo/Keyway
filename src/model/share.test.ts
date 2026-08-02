import { describe, expect, it } from "vitest";
import { decodeModel, encodeModel, modelFromLocation, shareUrl, SAFE_URL_LEN } from "./share";
import { DEFAULT_DOC } from "./doc";

describe("share encode/decode", () => {
  it("round-trips arbitrary model text", () => {
    const text = "@gsi GSI1 pk=GSI1PK sk=GSI1SK\nu1: PK=A  SK=B  name=Ada Lovelace";
    expect(decodeModel(encodeModel(text))).toBe(text);
  });

  it("round-trips the full default doc", () => {
    expect(decodeModel(encodeModel(DEFAULT_DOC))).toBe(DEFAULT_DOC);
  });

  it("compresses (encoded is shorter than naive encodeURIComponent for real docs)", () => {
    expect(encodeModel(DEFAULT_DOC).length).toBeLessThan(encodeURIComponent(DEFAULT_DOC).length);
  });

  it("returns null for garbage payloads", () => {
    expect(decodeModel("!!!not-valid!!!")).toBeNull();
    expect(decodeModel("")).toBeNull();
  });

  it("reads a model out of a location hash", () => {
    const text = "u1: PK=A  SK=B";
    const hash = `#m=${encodeModel(text)}`;
    expect(modelFromLocation(hash)).toBe(text);
    expect(modelFromLocation("#other=1")).toBeNull();
    expect(modelFromLocation("")).toBeNull();
  });

  it("shareUrl builds an origin+path#m= link that round-trips back", () => {
    (globalThis as unknown as { location: { origin: string; pathname: string } }).location = {
      origin: "https://ex.com",
      pathname: "/keyway/",
    };
    const text = "u1: PK=A  SK=B  name=Ada";
    const url = shareUrl(text);
    expect(url.startsWith("https://ex.com/keyway/#m=")).toBe(true);
    expect(modelFromLocation(new URL(url).hash)).toBe(text);
  });

  it("SAFE_URL_LEN is a sane paste ceiling", () => {
    expect(SAFE_URL_LEN).toBeGreaterThan(1000);
  });
});
