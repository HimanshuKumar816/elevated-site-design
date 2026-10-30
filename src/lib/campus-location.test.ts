import { describe, expect, it } from "vitest";
import { CAMPUS_CENTER, isInsideCampus } from "./campus-location";

describe("Chandigarh University campus map bounds", () => {
  it("includes the campus centre", () => {
    expect(isInsideCampus({ lat: CAMPUS_CENTER[0], lng: CAMPUS_CENTER[1] })).toBe(true);
  });

  it("accepts a coordinate on the campus area bounds", () => {
    expect(isInsideCampus({ lat: 30.761, lng: 76.56 })).toBe(true);
    expect(isInsideCampus({ lat: 30.778, lng: 76.586 })).toBe(true);
  });

  it("rejects points outside the campus area", () => {
    expect(isInsideCampus({ lat: 30.76, lng: 76.57386 })).toBe(false);
    expect(isInsideCampus({ lat: 30.779, lng: 76.57386 })).toBe(false);
    expect(isInsideCampus({ lat: 30.76858, lng: 76.559 })).toBe(false);
    expect(isInsideCampus({ lat: 30.76858, lng: 76.587 })).toBe(false);
  });

  it("rejects non-finite coordinates", () => {
    expect(isInsideCampus({ lat: Number.NaN, lng: 76.57386 })).toBe(false);
    expect(isInsideCampus({ lat: 30.76858, lng: Number.POSITIVE_INFINITY })).toBe(false);
  });
});
