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
