import { describe, expect, it } from "vitest";
import { columnOf, columnRange, columnStatus, orientedPairs, pairKey, type ComparisonResult } from "./comparison";

const result = {
  reference: 0,
  alignment: {
    // Colonne 0 : insertion de la protéine 1 ; protéine 2 sans 2e résidu
    columns: [
      [null, 1, null],
      [1, 2, 1],
      [2, 3, null],
      [3, 4, 2],
    ],
    kinds: ["insertion", "reference", "reference", "reference"],
    rows: ["-MKV", "AMKL", "-M-V"],
    reference: 0,
  },
  pairwise: { "0-1": { pairs: [[1, 2], [2, 3], [3, 4]] } },
} as unknown as ComparisonResult;

describe("correspondance des résidus", () => {
  it("donne la colonne de chaque résidu", () => {
    expect([...columnOf(result, 2).entries()]).toEqual([
      [1, 1],
      [2, 3],
    ]);
    expect(columnRange(columnOf(result, 1), 1, 3)).toEqual([0, 2]);
    expect(columnRange(columnOf(result, 2), 5, 9)).toBeNull();
  });

  it("oriente les paires quel que soit l'ordre de stockage", () => {
    expect(pairKey(2, 0)).toBe("0-2");
    expect(orientedPairs(result, 1, 0)[0]).toEqual([2, 1]);
    expect(orientedPairs(result, 0, 2)).toEqual([]);
  });

  it("qualifie chaque colonne", () => {
    expect(columnStatus(result.alignment.rows, 0)).toBe("gap");
    expect(columnStatus(result.alignment.rows, 1)).toBe("identical");
    expect(columnStatus(result.alignment.rows, 2)).toBe("partial");
    expect(columnStatus(result.alignment.rows, 3)).toBe("different");
  });
});
