// Sélection des homologues de l'Explorateur : filtres, regroupement des
// séquences proches (identité mutuelle) et diversité taxonomique.

import type { Homolog } from "./conservation";
import type { ExplorerResult } from "./explorer";

/** Homologue proposé : analysé, ou écarté lors d'une sélection précédente. */
export type PoolEntry = Homolog & {
  row: string;
  lineage: Record<string, string>;
  /** Fait partie de l'analyse affichée. */
  analysed: boolean;
  /** Écartée comme incomplète par le contrôle qualité (onglet Conservation). */
  qcReasons?: string[];
};

/** Tous les homologues retenus par l'alignement, analysés ou non. */
export function homologPool(result: ExplorerResult): PoolEntry[] {
  const rows = new Map(result.msa.map((m) => [m.accession, m.row]));
  const leaves = new Map((result.tree?.leaves ?? []).map((l) => [l.id, l.lineage]));
  const lineage = (h: Homolog) => h.lineage ?? leaves.get(h.accession) ?? {};
  return [
    ...result.homologs.map((h) => ({ ...h, row: rows.get(h.accession) ?? "", lineage: lineage(h), analysed: true })),
    ...(result.unselected ?? []).map((h) => ({ ...h, lineage: lineage(h), analysed: false })),
    ...(result.qc?.removed ?? []).map(({ reasons, ...h }) => ({ ...h, lineage: lineage(h), analysed: false, qcReasons: reasons })),
  ];
}

// ---------------------------------------------------------------------------
// Identité mutuelle
// ---------------------------------------------------------------------------

/** Positions alignées communes minimales pour comparer deux séquences. */
export const MIN_OVERLAP = 20;
const NONE = 0xffff;

/**
 * Identités entre homologues (‰, sur les positions alignées dans les deux
 * lignes), calculées par tranches pour ne pas bloquer la page.
 */
export type IdentityMatrix = { n: number; data: Uint16Array; codes: Uint8Array[]; next: number };

export function createIdentityMatrix(rows: string[]): IdentityMatrix {
  const codes = rows.map((row) => {
    const code = new Uint8Array(row.length);
    for (let k = 0; k < row.length; k++) code[k] = row[k] === "-" ? 0 : row.charCodeAt(k);
    return code;
  });
  return { n: rows.length, data: new Uint16Array(rows.length * rows.length).fill(NONE), codes, next: 0 };
}

/** Calcule les lignes suivantes pendant `budgetMs` ; renvoie la fraction terminée. */
export function fillIdentityMatrix(matrix: IdentityMatrix, budgetMs = Infinity): number {
  const { n, data, codes } = matrix;
  const start = Date.now();
  while (matrix.next < n) {
    const i = matrix.next++;
    const a = codes[i];
    data[i * n + i] = 1000;
    for (let j = i + 1; j < n; j++) {
      const b = codes[j];
      const length = Math.min(a.length, b.length);
      let overlap = 0;
      let same = 0;
      for (let k = 0; k < length; k++) {
        const x = a[k];
        const y = b[k];
        if (x && y) {
          overlap++;
          if (x === y) same++;
        }
      }
      const value = overlap >= MIN_OVERLAP ? Math.floor((1000 * same) / overlap) : NONE;
      data[i * n + j] = value;
      data[j * n + i] = value;
    }
    if (Date.now() - start > budgetMs) break;
  }
  return n ? matrix.next / n : 1;
}

/** Identité (0–1) entre deux homologues, null s'ils se recouvrent trop peu. */
export function identityBetween(matrix: IdentityMatrix, i: number, j: number): number | null {
  const value = matrix.data[i * matrix.n + j];
  return value === NONE ? null : value / 1000;
}

/** Identité la plus forte de chaque homologue avec un autre (redondance). */
export function nearestIdentity(matrix: IdentityMatrix): (number | null)[] {
  const { n, data } = matrix;
  return Array.from({ length: n }, (_, i) => {
    let best = -1;
    for (let j = 0; j < n; j++) {
      const value = data[i * n + j];
      if (j !== i && value !== NONE && value > best) best = value;
    }
    return best < 0 ? null : best / 1000;
  });
}

/** Ordre de préférence des représentants : Swiss-Prot, couverture, identité avec la référence. */
export function priorityOrder(pool: PoolEntry[]): number[] {
  return pool
    .map((_, k) => k)
    .sort((a, b) => {
      const x = pool[a];
      const y = pool[b];
      return Number(y.reviewed) - Number(x.reviewed) || y.coverage - x.coverage || y.identity - x.identity || a - b;
    });
}

export type Clusters = {
  /** Représentant du groupe de chaque homologue (indice dans le pool). */
  rep: Int32Array;
  /** Nombre de membres de chaque groupe, indexé par représentant. */
  size: Map<number, number>;
};

/**
 * Regroupement glouton (comme CD-HIT) : chaque homologue, dans l'ordre de
 * préférence, rejoint le premier représentant dont il partage au moins
 * `threshold` d'identité, ou fonde un nouveau groupe.
 */
export function clusterHomologs(matrix: IdentityMatrix, order: number[], threshold: number): Clusters {
  const limit = Math.round(threshold * 1000);
  const rep = new Int32Array(matrix.n).fill(-1);
  const size = new Map<number, number>();
  const reps: number[] = [];
  for (const i of order) {
    const found = reps.find((r) => {
      const value = matrix.data[i * matrix.n + r];
      return value !== NONE && value >= limit;
    });
    const owner = found ?? i;
    if (found === undefined) reps.push(i);
    rep[i] = owner;
    size.set(owner, (size.get(owner) ?? 0) + 1);
  }
  return { rep, size };
}

/**
 * Nombre effectif de séquences : chaque séquence compte pour 1 / (nombre de
 * séquences sélectionnées à ≥ 80 % d'identité d'elle), comme pour la coévolution.
 */
export function effectiveCount(matrix: IdentityMatrix, selected: number[], threshold = 0.8): number {
  const limit = Math.round(threshold * 1000);
  let neff = 0;
  for (const i of selected) {
    let neighbours = 0;
    for (const j of selected) {
      const value = matrix.data[i * matrix.n + j];
      if (value !== NONE && value >= limit) neighbours++;
    }
    neff += 1 / Math.max(neighbours, 1);
  }
  return neff;
}

// ---------------------------------------------------------------------------
// Filtres et sélection automatique
// ---------------------------------------------------------------------------

export type HomologFilters = {
  /** Identité avec la référence, en % */
  identityMin: number;
  identityMax: number;
  /** Couverture minimale de la référence, en % */
  coverageMin: number;
  lengthMin: number | null;
  lengthMax: number | null;
  /** Espèce, identifiant ou nom de protéine */
  text: string;
  taxon: { rank: string; name: string } | null;
  /** Seuil d'identité mutuelle du regroupement, en % */
  threshold: number;
  /** Un seul représentant par groupe de séquences proches */
  dedup: boolean;
  onePerSpecies: boolean;
};

export const DEFAULT_FILTERS: HomologFilters = {
  identityMin: 0,
  identityMax: 100,
  coverageMin: 0,
  lengthMin: null,
  lengthMax: null,
  text: "",
  taxon: null,
  threshold: 90,
  dedup: false,
  onePerSpecies: false,
};

export function passesFilters(h: PoolEntry, f: HomologFilters): boolean {
  const identity = h.identity * 100;
  if (identity < f.identityMin - 1e-9 || identity > f.identityMax + 1e-9) return false;
  if (h.coverage * 100 < f.coverageMin - 1e-9) return false;
  if (h.length != null) {
    if (f.lengthMin != null && h.length < f.lengthMin) return false;
    if (f.lengthMax != null && h.length > f.lengthMax) return false;
  }
  const text = f.text.trim().toLowerCase();
  if (text && ![h.accession, h.organism, h.protein_name].some((v) => v?.toLowerCase().includes(text))) return false;
  if (f.taxon && taxonOf(h, f.taxon.rank) !== f.taxon.name) return false;
  return true;
}

const speciesKey = (h: PoolEntry) => (h.taxon_id ? `t${h.taxon_id}` : h.organism ? `o${h.organism.toLowerCase()}` : null);

/**
 * Homologues retenus par les filtres, puis (si demandé) un seul par groupe de
 * séquences proches et un seul par espèce, les préférés d'abord.
 */
export function autoSelection(pool: PoolEntry[], f: HomologFilters, order: number[], clusters: Clusters | null): boolean[] {
  const chosen = pool.map((h) => passesFilters(h, f));
  const takenGroups = new Set<number>();
  const takenSpecies = new Set<string>();
  for (const i of order) {
    if (!chosen[i]) continue;
    if (f.dedup && clusters) {
      const group = clusters.rep[i];
      if (takenGroups.has(group)) {
        chosen[i] = false;
        continue;
      }
      takenGroups.add(group);
    }
    if (f.onePerSpecies) {
      const key = speciesKey(pool[i]);
      if (key && takenSpecies.has(key)) {
        chosen[i] = false;
        continue;
      }
      if (key) takenSpecies.add(key);
    }
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Taxonomie
// ---------------------------------------------------------------------------

export const TAXON_RANKS: { rank: string; label: string }[] = [
  { rank: "domain", label: "Domaine" },
  { rank: "kingdom", label: "Règne" },
  { rank: "phylum", label: "Embranchement" },
  { rank: "class", label: "Classe" },
  { rank: "order", label: "Ordre" },
  { rank: "family", label: "Famille" },
  { rank: "genus", label: "Genre" },
  { rank: "species", label: "Espèce" },
];

/** Taxon d'un homologue à un rang donné (genre et espèce lus dans le nom de l'organisme). */
export function taxonOf(h: Pick<PoolEntry, "organism" | "lineage">, rank: string): string | null {
  if (rank === "species") return h.organism?.trim() || null;
  if (rank === "genus") return h.organism?.trim().split(/\s+/)[0]?.replace(/^\[|\]$/g, "") || h.lineage?.genus || null;
  return h.lineage?.[rank] ?? null;
}

export type TaxonCount = { name: string | null; total: number; selected: number };

/** Effectifs par taxon, pour tout le pool et pour la sélection (du plus fréquent au moins fréquent). */
export function taxonCounts(pool: PoolEntry[], selected: boolean[], rank: string): TaxonCount[] {
  const counts = new Map<string | null, TaxonCount>();
  pool.forEach((h, k) => {
    const name = taxonOf(h, rank);
    const count = counts.get(name) ?? { name, total: 0, selected: 0 };
    count.total++;
    if (selected[k]) count.selected++;
    counts.set(name, count);
  });
  return [...counts.values()].sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : b.total - a.total || a.name.localeCompare(b.name)));
}

/** Indice de Shannon (ln) d'une liste d'effectifs. */
export function shannon(counts: number[]): number {
  const total = counts.reduce((s, c) => s + c, 0);
  if (!total) return 0;
  return Math.max(0, -counts.reduce((s, c) => (c ? s + (c / total) * Math.log(c / total) : s), 0));
}

/** Rang le plus fin qui sépare les homologues en 2 à 8 groupes (comme pour l'arbre). */
export function defaultRank(pool: PoolEntry[]): string {
  let chosen = "domain";
  for (const { rank } of TAXON_RANKS.slice(0, 6)) {
    const groups = new Set(pool.map((h) => taxonOf(h, rank)).filter(Boolean));
    if (groups.size >= 2 && groups.size <= 8) chosen = rank;
    else if (groups.size > 8) break;
  }
  return chosen;
}

/** Alignement de la référence et des homologues choisis (FASTA). */
export function selectionFasta(result: ExplorerResult, entries: PoolEntry[]) {
  const lines = [`>${result.reference.id}`, result.query_sequence];
  for (const h of entries) lines.push(`>${h.accession}${h.organism ? ` ${h.organism}` : ""}`, h.row);
  return lines.join("\n") + "\n";
}
