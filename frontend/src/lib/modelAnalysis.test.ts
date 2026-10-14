import { describe, expect, it } from "vitest";
import { toRanges } from "./modelAnalysis";

describe("toRanges", () => {
  it("regroupe les positions consécutives d'une poche", () => {
    expect(toRanges([12, 10, 11, 40, 42, 41, 7, 10])).toEqual([
      { start: 7, end: 7 },
      { start: 10, end: 12 },
      { start: 40, end: 42 },
    ]);
    expect(toRanges([])).toEqual([]);
  });
});
