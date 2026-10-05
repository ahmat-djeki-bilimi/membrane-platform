import { describe, expect, it } from "vitest";
import { mapRanges, toStructureRanges, type ResidueMapping } from "./mapping";

// 2RH1 : récepteur β2 en deux segments (231–263 remplacé par le lysozyme T4)
const mapping: ResidueMapping = {
  pdb_id: "2RH1",
  accession: "P07550",
  available: true,
  identity: true,
  segments: [
    { chain: "A", unp_start: 1, unp_end: 230, offset: 0, linear: true },
    { chain: "A", unp_start: 264, unp_end: 365, offset: 0, linear: true },
  ],
};

describe("toStructureRanges", () => {
  it("découpe une plage à cheval sur une région absente", () => {
    expect(toStructureRanges({ start: 220, end: 270 }, mapping)).toEqual([
      { start: 220, end: 230, chain: "A", numbering: "pdb" },
      { start: 264, end: 270, chain: "A", numbering: "pdb" },
    ]);
  });

  it("renvoie une liste vide pour une région absente de la structure", () => {
    expect(toStructureRanges({ start: 240, end: 250 }, mapping)).toEqual([]);
  });

  it("applique le décalage de numérotation", () => {
    const shifted: ResidueMapping = {
      ...mapping,
      segments: [{ chain: "B", unp_start: 2, unp_end: 162, offset: 1000, linear: true }],
    };
    expect(toStructureRanges({ start: 10, end: 20 }, shifted)).toEqual([
      { start: 1010, end: 1020, chain: "B", numbering: "pdb" },
    ]);
  });

  it("ne convertit pas une plage déjà en numérotation de la structure", () => {
    const range = { start: 5, end: 5, numbering: "pdb" as const };
    expect(toStructureRanges(range, mapping)).toEqual([range]);
  });

  it("garde la plage d'origine sans correspondance connue", () => {
    expect(mapRanges([{ start: 1, end: 9 }], null)).toEqual([{ start: 1, end: 9 }]);
  });
});
