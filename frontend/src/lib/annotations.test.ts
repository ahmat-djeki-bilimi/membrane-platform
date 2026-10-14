import { describe, expect, it } from "vitest";
import { referenceUrl, variantLabel, type FunctionalVariant } from "./annotations";

const variant = (v: Partial<FunctionalVariant>) => ({ start: 79, end: 79, original: "D", alternatives: ["N"], ...v }) as FunctionalVariant;

describe("annotations", () => {
  it("écrit les changements d'acides aminés", () => {
    expect(variantLabel(variant({}))).toBe("D79N");
    expect(variantLabel(variant({ alternatives: [] }))).toBe("D79del");
    expect(variantLabel(variant({ end: 81, original: "DRY", alternatives: ["AAA"] }))).toBe("DRY79-81AAA");
  });

  it("relie les références à leur source", () => {
    expect(referenceUrl({ source: "PubMed", id: "24056936" })).toBe("https://pubmed.ncbi.nlm.nih.gov/24056936/");
    expect(referenceUrl({ source: "PDB", id: "2RH1" })).toBe("https://www.rcsb.org/structure/2RH1");
    expect(referenceUrl({ source: "Inconnue", id: "x" })).toBeNull();
  });
});
