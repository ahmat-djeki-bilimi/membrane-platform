import { describe, expect, it } from "vitest";
import {
  computeProperties,
  estimateTMSegments,
  findMotif,
  parseSequenceInput,
  positiveInsideRule,
  prositeToRegex,
} from "./sequence";

describe("parseSequenceInput", () => {
  it("lit un FASTA et ignore espaces et numéros", () => {
    const r = parseSequenceInput(">sp|X|test\nMKT 10 ALV\n");
    expect(r.ok && r.value).toMatchObject({ header: "sp|X|test", sequence: "MKTALV" });
  });

  it("n'analyse que la première séquence d'un FASTA multiple", () => {
    const r = parseSequenceInput(">a\nMKTAAAAAAAAAAAAAAAAAAA\n>b\nGGG");
    expect(r.ok && r.value.sequence).toBe("MKTAAAAAAAAAAAAAAAAAAA");
    expect(r.ok && r.value.warnings[0]).toMatch(/2 séquences/);
  });

  it("refuse l'ADN", () => {
    const r = parseSequenceInput("ATGCGTACGTAGCTAGCTAGCATCG");
    expect(r.ok).toBe(false);
  });

  it("retire les tirets d'alignement et le codon stop final", () => {
    const r = parseSequenceInput("MK-TL*");
    expect(r.ok && r.value.sequence).toBe("MKTL");
  });
});

describe("computeProperties", () => {
  it("masse de l'alanine libre", () => {
    expect(computeProperties("A").molecularWeight).toBeCloseTo(89.09, 2);
  });

  it("pI basique pour une séquence riche en lysines", () => {
    expect(computeProperties("KKKKKKKKKK").isoelectricPoint).toBeGreaterThan(10);
  });
});

describe("estimateTMSegments", () => {
  const helix = "LLLLVVVIIIAAALLLFFLLV";
  const seq = "MKKRSEDKRKDE" + helix + "KRKDEDSGRKKDEESNTQKDERKG" + "ILLVAVLLIFALVLLGVAIL" + "DEKRSTNQ";

  it("trouve les deux hélices hydrophobes", () => {
    const segments = estimateTMSegments(seq);
    expect(segments).toHaveLength(2);
    expect(segments[0].start).toBeGreaterThanOrEqual(12);
    expect(segments[0].end).toBeLessThanOrEqual(34);
  });

  it("applique la règle positive-inside", () => {
    const hint = positiveInsideRule(seq, estimateTMSegments(seq));
    expect(hint).not.toBeNull();
    expect(hint!.krNSide + hint!.krOtherSide).toBeGreaterThan(0);
  });
});

describe("motifs PROSITE", () => {
  it("convertit la syntaxe PROSITE", () => {
    expect(prositeToRegex("N-{P}-[ST]-{P}")).toBe("N[^P][ST][^P]");
    expect(prositeToRegex("[ST]-x(2)-[DE]")).toBe("[ST].{2}[DE]");
  });

  it("trouve les occurrences chevauchantes", () => {
    const { hits } = findMotif("NASANTSRGD", "N-{P}-[ST]-{P}");
    expect(hits.map((h) => h.start)).toEqual([1, 5]);
  });

  it("signale un motif invalide", () => {
    expect(findMotif("MKT", "[").error).not.toBeNull();
  });
});
