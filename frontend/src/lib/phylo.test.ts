import { describe, expect, it } from "vitest";
import type { PhyloNode } from "./conservation";
import {
  groupColors,
  GROUP_COLORS,
  layoutTree,
  leafColoring,
  leafKey,
  legendRows,
  OTHER_COLOR,
  OTHER_LABEL,
  scaleBarLength,
  UNKNOWN_GROUP_COLOR,
  UNKNOWN_LABEL,
} from "./phylo";

// ((A:1,B:2):0.5,C:3)
const leaf = (i: number, length: number): PhyloNode => ({ leaf: i, length, size: 1 });
const TREE: PhyloNode = {
  length: 0,
  size: 3,
  children: [{ length: 0.5, size: 2, support: 0.95, children: [leaf(0, 1), leaf(1, 2)] }, leaf(2, 3)],
};

describe("layoutTree", () => {
  it("place les feuilles de haut en bas et les nœuds au milieu de leurs enfants", () => {
    const { order, nodes } = layoutTree(TREE);
    expect(order).toEqual([0, 1, 2]);
    const inner = nodes.find((n) => n.support === 0.95)!;
    expect(inner.y).toBe(0.5);
    expect(inner.childrenY).toEqual([0, 1]);
  });

  it("phylogramme : abscisse = somme des longueurs depuis la racine", () => {
    const { nodes, depth } = layoutTree(TREE, "phylogram");
    const x = (i: number) => nodes.find((n) => n.leaf === i)!.x;
    expect([x(0), x(1), x(2)]).toEqual([1.5, 2.5, 3]);
    expect(depth).toBe(3);
  });

  it("cladogramme : toutes les feuilles alignées", () => {
    const { nodes } = layoutTree(TREE, "cladogram");
    const xs = nodes.filter((n) => n.leaf !== undefined).map((n) => n.x);
    expect(new Set(xs).size).toBe(1);
  });

  it("ignore les longueurs négatives", () => {
    const tree: PhyloNode = { length: 0, size: 2, children: [leaf(0, -1), leaf(1, 1)] };
    const { nodes } = layoutTree(tree);
    expect(nodes.find((n) => n.leaf === 0)!.x).toBe(0);
  });
});

describe("scaleBarLength", () => {
  it("choisit un pas rond proche du cinquième de la profondeur", () => {
    expect(scaleBarLength(0.5)).toBe(0.1);
    expect(scaleBarLength(1.3)).toBeCloseTo(0.2);
    expect(scaleBarLength(0.04)).toBeCloseTo(0.01);
  });
});

describe("groupColors", () => {
  it("attribue les couleurs dans l'ordre, sans les recycler", () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({ name: `G${i}` }));
    const colors = groupColors(groups);
    expect(colors.get("G0")).toBe(GROUP_COLORS[0]);
    expect(colors.size).toBe(GROUP_COLORS.length);
    expect(colors.has("G9")).toBe(false);
  });
});

describe("coloration des feuilles", () => {
  const leaf = (organism: string | null, phylum?: string) => ({ organism, lineage: (phylum ? { phylum } : {}) as Record<string, string> });

  it("colore par groupe taxonomique ou par organisme", () => {
    const leaves = [leaf("Homo sapiens", "Chordata"), leaf("Mus musculus", "Chordata"), leaf("Drosophila melanogaster", "Arthropoda"), leaf(null)];
    const byPhylum = leafColoring(leaves, "group", "phylum");
    expect(byPhylum.legend.map((l) => [l.name, l.count])).toEqual([["Chordata", 2], ["Arthropoda", 1], [UNKNOWN_LABEL, 1]]);
    expect(byPhylum.colorOf(leaves[0])).toBe(GROUP_COLORS[0]);
    expect(byPhylum.colorOf(leaves[3])).toBe(UNKNOWN_GROUP_COLOR);
    expect(leafColoring(leaves, "organism", "phylum").legend).toHaveLength(4);
    expect(leafKey(leaf("[Candida] glabrata (levure)"), "group", "genus")).toBe("Candida");
    expect(leafColoring(leaves, "none", "phylum").legend).toEqual([]);
  });

  it("réunit sous « Autres » les groupes au-delà de la palette", () => {
    const leaves = Array.from({ length: 10 }, (_, k) => leaf(`Espèce ${String.fromCharCode(65 + k)}`));
    const coloring = leafColoring(leaves, "organism", "phylum");
    expect(coloring.legend).toHaveLength(GROUP_COLORS.length);
    expect(coloring.legend.at(-1)!.name.startsWith(OTHER_LABEL)).toBe(true);
    expect(coloring.colorOf(leaves[9])).toBe(OTHER_COLOR);
  });

  it("découpe la légende en lignes", () => {
    const items = Array.from({ length: 6 }, (_, k) => ({ name: `Groupe ${k}`, count: 1 }));
    const rows = legendRows(items, 200);
    expect(rows.flat()).toHaveLength(6);
    expect(rows.length).toBeGreaterThan(1);
  });
});
