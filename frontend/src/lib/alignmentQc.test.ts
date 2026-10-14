import { describe, expect, it } from "vitest";
import { EMPTY_FORM, checkMapping, formFromParams, mappingCsv, paramsFromForm, previewQuality } from "./alignmentQc";
import type { AlignmentQuality, ExplorerResult } from "./explorer";

const QUERY = "MKLVAIGLLF";

function fixture() {
  const msa = [
    { accession: "a", organism: "A", row: "MKLVAIGLLF" },
    { accession: "b", organism: "B", row: "MKLV-IGL--" },
  ];
  const quality = {
    params: { min_coverage: null, max_internal_gap: null, max_column_gaps: null, mask_poor_regions: false },
    columns: {
      gap_fraction: [0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0.5],
      identity: Array(10).fill(1),
      similarity: Array(10).fill(1),
      masked: Array(10).fill(false),
      reasons: Array(10).fill(null),
    },
    sequences: [
      { accession: "a", coverage: 1, start: 1, end: 10, longest_internal_gap: 0, internal_gaps: 0, removed: false },
      { accession: "b", coverage: 0.7, start: 1, end: 8, longest_internal_gap: 1, internal_gaps: 1, removed: false },
      { accession: "c", coverage: 0.3, start: 1, end: 3, longest_internal_gap: 0, internal_gaps: 0, removed: true },
    ],
    removed: [{ accession: "c", row: "MKL-------", reasons: ["couverture"] }],
    poor_regions: [{ start: 9, end: 10, length: 2, mean_gap: 0.5, mean_similarity: 0.5, reason: "gaps" }],
    diversity: { mean_pairwise_identity: 0.9, median_identity_to_reference: 1, neff: 2, neff_per_length: 0.2, sampled: 2 },
    mapping: { columns: 10, reference_length: 10, exact: true, source_columns: null },
    summary: { sequences: 3, kept: 2, removed: 1, masked_columns: 0, high_gap_columns: 0, mean_gap: 0.15, median_coverage: 0.85, poor_region_positions: 2 },
  } as unknown as AlignmentQuality;
  const result = {
    query_sequence: QUERY,
    msa,
    positions: QUERY.split("").map((residue, k) => ({ position: k + 1, residue, grade: 5 })),
    qc: quality,
  } as unknown as ExplorerResult;
  return { result, quality };
}

describe("réglages du contrôle qualité", () => {
  it("convertit pourcentages et fractions dans les deux sens", () => {
    const form = formFromParams({ min_coverage: 0.7, max_column_gaps: 0.5, mask_poor_regions: true });
    expect(form).toEqual({ minCoverage: 70, maxInternalGap: null, maxColumnGaps: 50, maskPoorRegions: true });
    expect(paramsFromForm(form)).toEqual({ min_coverage: 0.7, max_column_gaps: 0.5, mask_poor_regions: true });
    expect(paramsFromForm(EMPTY_FORM)).toBeNull();
  });
});

describe("aperçu", () => {
  it("réintègre une séquence écartée quand le filtre est retiré", () => {
    const { result, quality } = fixture();
    const preview = previewQuality(result, quality, EMPTY_FORM);
    expect(preview.kept).toEqual(["a", "b", "c"]);
    // Colonne 4 : gap seulement dans c
    expect(preview.gapFraction[3]).toBeCloseTo(1 / 3);
  });

  it("écarte les séquences incomplètes et masque les colonnes sans décaler les positions", () => {
    const { result, quality } = fixture();
    const preview = previewQuality(result, quality, { minCoverage: 50, maxInternalGap: 0, maxColumnGaps: 40, maskPoorRegions: false });
    expect(preview.kept).toEqual(["a"]);
    expect(preview.removed.map((r) => r.accession)).toEqual(["b", "c"]);
    expect(preview.maskedCount).toBe(0);
    const loose = previewQuality(result, quality, { minCoverage: 50, maxInternalGap: null, maxColumnGaps: 40, maskPoorRegions: true });
    expect(loose.masked).toHaveLength(QUERY.length);
    expect(loose.masked.map((m, k) => (m ? k + 1 : 0)).filter(Boolean)).toEqual([5, 9, 10]);
  });
});

describe("correspondance colonnes ↔ résidus", () => {
  it("vérifie que la colonne k porte le résidu k", () => {
    const { result, quality } = fixture();
    expect(checkMapping(result).exact).toBe(true);
    const csv = mappingCsv(result, quality).trim().split("\n");
    expect(csv).toHaveLength(QUERY.length + 1);
    expect(csv[1].startsWith("1;1;M;")).toBe(true);
    const broken = { ...result, msa: [{ accession: "x", organism: "X", row: "MK" }] } as ExplorerResult;
    expect(checkMapping(broken).exact).toBe(false);
  });
});
