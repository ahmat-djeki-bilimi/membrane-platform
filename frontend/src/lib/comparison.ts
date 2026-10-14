// Comparaison de deux à six protéines (route /api/comparison, calcul en file).

import { API_BASE } from "./api";
import { readJob, useJob, type Job, type JobState } from "./jobs";
import { GROUP_COLORS } from "./phylo";
import type { TopologySource } from "./prediction";

export const MIN_PROTEINS = 2;
export const MAX_PROTEINS = 6;

export type Properties = {
  length: number;
  molecular_weight: number | null;
  isoelectric_point: number | null;
  net_charge_ph7: number | null;
  gravy: number | null;
  aliphatic_index: number;
  aromatic_fraction: number;
  hydrophobic_fraction: number;
  polar_fraction: number;
  charged_fraction: number;
  positive: number;
  negative: number;
  cysteines: number;
  composition: Record<string, number>;
  nonstandard: number;
  hydropathy_profile: (number | null)[];
};

export type ComparedProtein = {
  accession: string;
  name: string;
  gene: string | null;
  organism: string | null;
  reviewed: boolean;
  sequence: string;
  length: number;
  domains: { type: string; name: string; start: number; end: number }[];
  topology: { source: TopologySource; segments: { start: number; end: number; label?: string }[]; n_terminus: "in" | "out" | null };
  properties: Properties;
};

export type PairComparison = {
  /** Paires [résidu de la 1re protéine, résidu de la 2e], numérotation UniProt. */
  pairs: [number, number][];
  aligned: number;
  identity: number;
  similarity: number;
  coverage_a: number;
  coverage_b: number;
  bits: number;
  evalue: number;
  doubtful: { a: [number, number]; b: [number, number] }[];
  reliability: "fiable" | "a_verifier" | "non_significative";
  reliability_text: string;
  structure_confirmed: number | null;
};

export type StructurePair = {
  aligned_pairs: number;
  superposed_on: number;
  confident_only: boolean;
  rmsd: number;
  tm_score_a: number;
  tm_score_b: number;
  confirmed: number;
  /** [résidu a, résidu b, distance Cα en Å après superposition] */
  distances: [number, number, number][];
};

export type ComparisonResult = {
  proteins: ComparedProtein[];
  reference: number;
  /** Clé « a-b » avec a < b (indices des protéines). */
  pairwise: Record<string, PairComparison>;
  alignment: { columns: (number | null)[][]; kinds: ("reference" | "insertion")[]; rows: string[]; reference: number };
  structures: {
    models: { available: boolean; model_id: string | null; mean_plddt: number | null; same_sequence: boolean }[];
    pairs: Record<string, StructurePair>;
    superposed: { protein: number; pdb: string }[];
  };
  topology: {
    segments: { id: number; columns: [number, number]; proteins: Record<string, [number, number][]>; shared: number }[];
    differences: string[];
  };
  domains: {
    type: string;
    name: string;
    proteins: Record<string, { start: number; end: number; columns: { start: number; end: number } | null }[]>;
    shared: number;
    aligned_overlap: number | null;
  }[];
  method: { alignment: string; structure: string; reliability: string };
};

export type ComparisonJob = Job<ComparisonResult> & { kind?: string; params?: { accessions?: string[]; reference?: number } };

export async function submitComparison(accessions: string[], reference: number): Promise<ComparisonJob> {
  const response = await fetch(`${API_BASE}/api/comparison`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessions, reference }),
  });
  return readJob(response);
}

export function useComparisonJob(jobId: string | null): JobState<ComparisonResult, ComparisonJob> {
  return useJob<ComparisonResult, ComparisonJob>(
    jobId ? () => fetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}`).then(readJob) : null,
    jobId ?? ""
  );
}

/** Couleur fixe de chaque protéine (ordre de saisie). */
export const proteinColor = (index: number) => GROUP_COLORS[index % GROUP_COLORS.length];

export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Paire vue depuis la protéine a : résidus [a, b] quel que soit l'ordre de stockage. */
export function orientedPairs(result: ComparisonResult, a: number, b: number): [number, number][] {
  const pair = result.pairwise[pairKey(a, b)];
  if (!pair) return [];
  return a < b ? pair.pairs : pair.pairs.map(([x, y]) => [y, x]);
}

/** Colonne de l'alignement de chaque résidu d'une protéine. */
export function columnOf(result: ComparisonResult, protein: number): Map<number, number> {
  const map = new Map<number, number>();
  result.alignment.columns.forEach((column, k) => {
    const residue = column[protein];
    if (residue) map.set(residue, k);
  });
  return map;
}

/** Plage de colonnes couverte par une plage de résidus (null si aucun résidu dans l'alignement). */
export function columnRange(index: Map<number, number>, start: number, end: number): [number, number] | null {
  let low = Infinity;
  let high = -Infinity;
  for (let r = start; r <= end; r++) {
    const c = index.get(r);
    if (c !== undefined) {
      low = Math.min(low, c);
      high = Math.max(high, c);
    }
  }
  return low <= high ? [low, high] : null;
}

/** Colonne de l'alignement → identité, similarité ou différence entre les résidus présents. */
export function columnStatus(rows: string[], column: number): "identical" | "partial" | "different" | "gap" {
  const residues = rows.map((r) => r[column]).filter((c) => c && c !== "-");
  if (residues.length < 2) return "gap";
  if (residues.every((c) => c === residues[0])) return residues.length === rows.length ? "identical" : "partial";
  return "different";
}

export const RELIABILITY_LABELS: Record<PairComparison["reliability"], string> = {
  fiable: "Fiable",
  a_verifier: "À vérifier",
  non_significative: "Non significative",
};
