// Mise en page d'un arbre phylogénétique raciné (représentation rectangulaire).

import type { PhyloNode } from "./conservation";

export type TreeMode = "phylogram" | "cladogram";

export type LaidOutNode = {
  x: number; // distance à la racine (unités de branche ou niveaux)
  y: number; // rang vertical (feuilles : 0, 1, 2… ; nœuds internes : milieu des enfants)
  parentX: number;
  leaf?: number;
  support?: number | null;
  childrenY?: [number, number]; // étendue verticale du trait reliant les enfants
};

export type TreeLayout = {
  nodes: LaidOutNode[];
  /** Indices des feuilles, de haut en bas. */
  order: number[];
  /** Abscisse maximale (profondeur de l'arbre). */
  depth: number;
};

/** Hauteur (en niveaux) d'un nœud : 0 pour une feuille. */
function height(node: PhyloNode): number {
  if (!node.children?.length) return 0;
  return 1 + Math.max(...node.children.map(height));
}

/**
 * Positions de chaque nœud. En phylogramme, l'abscisse est la somme des
 * longueurs de branches depuis la racine ; en cladogramme, les feuilles sont
 * alignées à droite et seule la topologie compte.
 */
export function layoutTree(root: PhyloNode, mode: TreeMode = "phylogram"): TreeLayout {
  const nodes: LaidOutNode[] = [];
  const order: number[] = [];
  const total = height(root);

  const visit = (node: PhyloNode, parentX: number, depthFromRoot: number): number => {
    const x =
      mode === "phylogram"
        ? parentX + (depthFromRoot === 0 ? 0 : Math.max(0, node.length))
        : total - height(node);
    if (!node.children?.length) {
      const y = order.length;
      order.push(node.leaf ?? -1);
      nodes.push({ x, y, parentX, leaf: node.leaf });
      return y;
    }
    const ys = node.children.map((child) => visit(child, x, depthFromRoot + 1));
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    nodes.push({
      x,
      y,
      parentX: depthFromRoot === 0 ? x : parentX,
      support: node.support,
      childrenY: [Math.min(...ys), Math.max(...ys)],
    });
    return y;
  };

  visit(root, 0, 0);
  const depth = Math.max(...nodes.map((n) => n.x), 1e-9);
  return { nodes, order, depth };
}

/** Pas « rond » pour l'échelle des longueurs de branches (0,01 · 0,02 · 0,05 · 0,1…). */
export function scaleBarLength(depth: number): number {
  const target = depth / 5;
  if (target <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(target));
  const candidates = [1, 2, 5, 10].map((m) => m * power);
  return candidates.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best));
}

// Palette catégorielle validée (ordre fixe, jamais recyclée)
export const GROUP_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
export const UNKNOWN_GROUP_COLOR = "#94a3b8";

/** Couleur de chaque groupe, attribuée dans l'ordre des groupes (du plus fréquent au moins fréquent). */
export function groupColors(groups: { name: string }[]): Map<string, string> {
  return new Map(groups.slice(0, GROUP_COLORS.length).map((g, i) => [g.name, GROUP_COLORS[i]]));
}

// ---------------------------------------------------------------------------
// Coloration des feuilles
// ---------------------------------------------------------------------------

export type ColorMode = "group" | "organism" | "none";

export const TREE_RANKS = [
  { rank: "domain", label: "Domaine" },
  { rank: "kingdom", label: "Règne" },
  { rank: "phylum", label: "Embranchement" },
  { rank: "class", label: "Classe" },
  { rank: "order", label: "Ordre" },
  { rank: "family", label: "Famille" },
  { rank: "genus", label: "Genre" },
];

/** Groupes au-delà des couleurs disponibles : réunis sous « Autres ». */
export const OTHER_COLOR = "#475569";
export const OTHER_LABEL = "Autres";
export const UNKNOWN_LABEL = "Non classé";

type LeafInfo = { organism: string | null; lineage?: Record<string, string> | null };

export const organismName = (organism: string | null) => organism?.replace(/\s*\(.*\)$/, "").trim() || null;

/** Clé de couleur d'une feuille : taxon au rang choisi, ou nom de l'organisme. */
export function leafKey(leaf: LeafInfo, mode: ColorMode, rank: string): string | null {
  if (mode === "organism") return organismName(leaf.organism);
  if (mode === "group") {
    if (rank === "genus") return organismName(leaf.organism)?.split(/\s+/)[0]?.replace(/^\[|\]$/g, "") || null;
    return leaf.lineage?.[rank] ?? null;
  }
  return null;
}

export type LeafColoring = {
  colorOf: (leaf: LeafInfo) => string;
  legend: { name: string; color: string; count: number }[];
};

/**
 * Couleurs des feuilles : les groupes sont classés par effectif (puis par
 * nom), les 8 premiers reçoivent la palette dans l'ordre ; s'il y en a plus,
 * les 7 premiers gardent leur couleur et les autres sont réunis sous « Autres ».
 */
export function leafColoring(leaves: LeafInfo[], mode: ColorMode, rank: string): LeafColoring {
  if (mode === "none") return { colorOf: () => "#334155", legend: [] };
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const leaf of leaves) {
    const key = leafKey(leaf, mode, rank);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    else unknown++;
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = sorted.length > GROUP_COLORS.length ? sorted.slice(0, GROUP_COLORS.length - 1) : sorted;
  const colors = new Map(named.map(([name], i) => [name, GROUP_COLORS[i]]));
  const others = sorted.slice(named.length).reduce((s, [, c]) => s + c, 0);
  const legend = named.map(([name, count]) => ({ name, color: colors.get(name)!, count }));
  if (others) legend.push({ name: `${OTHER_LABEL} (${sorted.length - named.length} groupes)`, color: OTHER_COLOR, count: others });
  if (unknown) legend.push({ name: UNKNOWN_LABEL, color: UNKNOWN_GROUP_COLOR, count: unknown });
  return {
    colorOf: (leaf) => {
      const key = leafKey(leaf, mode, rank);
      return key ? (colors.get(key) ?? OTHER_COLOR) : UNKNOWN_GROUP_COLOR;
    },
    legend,
  };
}

/** Légende découpée en lignes d'au plus `width` pixels (largeur des caractères estimée). */
export function legendRows<T extends { name: string; count: number }>(items: T[], width: number, charPx = 7): T[][] {
  const rows: T[][] = [[]];
  let used = 0;
  for (const item of items) {
    const w = 22 + (item.name.length + String(item.count).length + 3) * charPx;
    if (used + w > width && rows[rows.length - 1].length) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1].push(item);
    used += w;
  }
  return rows.filter((r) => r.length);
}
