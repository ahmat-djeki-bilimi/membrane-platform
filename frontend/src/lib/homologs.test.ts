import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  autoSelection,
  clusterHomologs,
  createIdentityMatrix,
  defaultRank,
  effectiveCount,
  fillIdentityMatrix,
  identityBetween,
  nearestIdentity,
  priorityOrder,
  shannon,
  taxonCounts,
  taxonOf,
  type PoolEntry,
} from "./homologs";

const BASE = "MKTLLVAIGLLFAVILGLVAWLRKDNGSEQ";

const mutate = (positions: number[]) =>
  BASE.split("")
    .map((c, k) => (positions.includes(k) ? (c === "W" ? "F" : "W") : c))
    .join("");

function entry(accession: string, row: string, extra: Partial<PoolEntry> = {}): PoolEntry {
  return {
    accession,
    entry_name: accession,
    protein_name: null,
    organism: null,
    taxon_id: null,
    reviewed: false,
    length: row.replace(/-/g, "").length,
    identity: 0.8,
    coverage: 1,
    row,
    lineage: {},
    analysed: true,
    ...extra,
  };
}

function matrixOf(rows: string[]) {
  const matrix = createIdentityMatrix(rows);
  expect(fillIdentityMatrix(matrix)).toBe(1);
  return matrix;
}

describe("identités mutuelles", () => {
  it("compare les positions alignées dans les deux lignes", () => {
    const matrix = matrixOf([BASE, mutate([0, 1, 2]), "-".repeat(15) + BASE.slice(15)]);
    expect(identityBetween(matrix, 0, 1)).toBe(0.9);
    expect(identityBetween(matrix, 1, 0)).toBe(0.9);
    expect(identityBetween(matrix, 0, 0)).toBe(1);
    // Moins de 20 positions communes : pas de comparaison
    expect(identityBetween(matrix, 0, 2)).toBeNull();
    expect(nearestIdentity(matrix)).toEqual([0.9, 0.9, null]);
  });

  it("se calcule par tranches", () => {
    const matrix = createIdentityMatrix([BASE, BASE, BASE]);
    fillIdentityMatrix(matrix, -1);
    expect(matrix.next).toBe(1);
    expect(fillIdentityMatrix(matrix)).toBe(1);
  });
});

describe("regroupement et sélection", () => {
  const pool = [
    entry("a", mutate([0, 1, 2]), { coverage: 0.9 }),
    entry("b", mutate([0, 1]), { reviewed: true }),
    entry("c", mutate([10, 11, 12, 13, 14, 15, 16, 17]), { identity: 0.3, organism: "Homo sapiens", taxon_id: 9606 }),
    entry("d", mutate([10, 11, 12, 13, 14, 15, 16, 18]), { organism: "Homo sapiens", taxon_id: 9606, length: 500 }),
  ];
  const matrix = matrixOf(pool.map((h) => h.row));
  const order = priorityOrder(pool);

  it("préfère Swiss-Prot puis la couverture", () => {
    expect(order[0]).toBe(1);
  });

  it("regroupe les séquences proches autour d'un représentant", () => {
    const clusters = clusterHomologs(matrix, order, 0.9);
    expect(clusters.rep[0]).toBe(1);
    expect(clusters.rep[1]).toBe(1);
    expect(clusters.size.get(1)).toBe(2);
    expect(clusters.rep[3]).toBe(clusters.rep[2]);
    // Seuil de 100 % : chaque séquence est seule
    expect(clusterHomologs(matrix, order, 1).size.size).toBe(4);
  });

  it("applique filtres, déduplication et une séquence par espèce", () => {
    const clusters = clusterHomologs(matrix, order, 0.9);
    expect(autoSelection(pool, DEFAULT_FILTERS, order, clusters)).toEqual([true, true, true, true]);
    expect(autoSelection(pool, { ...DEFAULT_FILTERS, identityMin: 50 }, order, clusters)).toEqual([true, true, false, true]);
    expect(autoSelection(pool, { ...DEFAULT_FILTERS, lengthMax: 100 }, order, clusters)).toEqual([true, true, true, false]);
    expect(autoSelection(pool, { ...DEFAULT_FILTERS, text: "sapiens" }, order, clusters)).toEqual([false, false, true, true]);
    expect(autoSelection(pool, { ...DEFAULT_FILTERS, dedup: true }, order, clusters).filter(Boolean)).toHaveLength(2);
    // Même espèce : la séquence préférée (d, plus proche de la référence) est gardée
    expect(autoSelection(pool, { ...DEFAULT_FILTERS, onePerSpecies: true }, order, clusters)).toEqual([true, true, false, true]);
  });

  it("compte les séquences effectives", () => {
    expect(effectiveCount(matrix, [0, 1, 2, 3])).toBeCloseTo(2);
    expect(effectiveCount(matrix, [0, 2])).toBeCloseTo(2);
  });
});

describe("taxonomie", () => {
  const pool = [
    entry("a", BASE, { organism: "Escherichia coli", lineage: { domain: "Bacteria", phylum: "Pseudomonadota" } }),
    entry("b", BASE, { organism: "Escherichia albertii", lineage: { domain: "Bacteria", phylum: "Pseudomonadota" } }),
    entry("c", BASE, { organism: "Bacillus subtilis", lineage: { domain: "Bacteria", phylum: "Bacillota" } }),
    entry("d", BASE, { organism: null }),
  ];

  it("lit le genre et l'espèce dans le nom de l'organisme", () => {
    expect(taxonOf(pool[0], "genus")).toBe("Escherichia");
    expect(taxonOf(pool[0], "species")).toBe("Escherichia coli");
    expect(taxonOf(pool[0], "phylum")).toBe("Pseudomonadota");
    expect(taxonOf(pool[3], "phylum")).toBeNull();
  });

  it("compte les groupes du pool et de la sélection", () => {
    expect(taxonCounts(pool, [true, false, true, true], "genus")).toEqual([
      { name: "Escherichia", total: 2, selected: 1 },
      { name: "Bacillus", total: 1, selected: 1 },
      { name: null, total: 1, selected: 1 },
    ]);
    expect(defaultRank(pool)).toBe("phylum");
  });

  it("calcule l'indice de Shannon", () => {
    expect(shannon([5])).toBe(0);
    expect(shannon([1, 1])).toBeCloseTo(Math.log(2));
    expect(shannon([])).toBe(0);
  });
});
