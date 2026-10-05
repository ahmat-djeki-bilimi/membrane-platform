// Structure prédite par ESMFold et placée dans la membrane (route /api/predicted-structure, calcul en file).

import { API_BASE } from "./api";
import { readJob, useJob, type Job, type JobState } from "./jobs";
import type { TMSegment } from "./sequence";

export type TopologySource = "deeptmhmm" | "uniprot" | "user" | "kd";

export type PredictedHelix = {
  label: string;
  start: number;
  end: number;
  length: number;
  tilt: number;
  direction: "in_to_out" | "out_to_in";
  z_start: number;
  z_end: number;
  span: number;
  crosses: boolean;
  /** full : atteint les deux faces ; short : la boucle voisine termine la traversée ; partial : ne traverse pas. */
  crossing: "full" | "short" | "partial";
  /** Hélice réelle dans la structure (souvent plus longue que le segment prédit). */
  helix_start: number;
  helix_end: number;
  reach_start: number;
  reach_end: number;
  mean_plddt: number | null;
};

export type MembraneResidue = { number: number; aa: string; z: number; plddt: number; face?: "externe" | "interne" };

export type PredictedRegion = {
  kind: "tm" | "loop_in" | "loop_out";
  label: string;
  start: number;
  end: number;
  mean_plddt: number | null;
  side: "in" | "out" | null;
};

export type InterpretationNote = {
  level: "good" | "info" | "warning";
  topic: "confidence" | "membrane" | "topology" | "helices" | "residues" | "limits";
  title: string;
  text: string;
};

export type PredictionResult = {
  name: string;
  length: number;
  method: string;
  pdb: string;
  embedded: boolean;
  mean_plddt: number | null;
  residues: { number: number; aa: string; plddt: number }[];
  window: { start: number; end: number; complete: boolean; max_length: number };
  tm_source: TopologySource;
  tm_segments: TMSegment[];
  interpretation: InterpretationNote[];
  // Présents seulement si la structure a été placée dans la membrane
  membrane?: {
    thickness: number;
    at_search_limit: boolean;
    initial_to_final_angle: number;
    side_method: "topology" | "positive_inside";
    kr_inside: number;
    kr_outside: number;
    n_terminus: "in" | "out";
  };
  helices?: PredictedHelix[];
  aromatic_belt?: MembraneResidue[];
  buried_charged?: MembraneResidue[];
  regions?: PredictedRegion[];
  tm_mean_plddt?: number | null;
  loop_mean_plddt?: number | null;
};

export type PredictionJob = Job<PredictionResult> & { max_length: number; tm_source: TopologySource };

export type KnownTopology = {
  tm_segments: TMSegment[];
  n_terminus?: "in" | "out" | null;
  tm_source: Exclude<TopologySource, "kd">;
};

export const TOPOLOGY_SOURCE_LABELS: Record<TopologySource, string> = {
  deeptmhmm: "DeepTMHMM",
  uniprot: "annotation UniProt",
  user: "topologie fournie",
  kd: "estimation Kyte-Doolittle",
};

// Couleurs et seuils officiels d’AlphaFold DB, repris pour ESMFold
export const PLDDT_BANDS = [
  { min: 90, color: "#0053d6", label: "Très élevé (> 90)" },
  { min: 70, color: "#65cbf3", label: "Confiant (70–90)" },
  { min: 50, color: "#ffdb13", label: "Faible (50–70)" },
  { min: 0, color: "#ff7d45", label: "Très faible (< 50)" },
] as const;

export const plddtColor = (score: number) => (PLDDT_BANDS.find((b) => score >= b.min) ?? PLDDT_BANDS[3]).color;

export type PredictionState = JobState<PredictionResult, PredictionJob>;

/** Structure prédite d'une entrée UniProt ; `start` choisit la fenêtre modélisée. */
export function usePredictedStructure(accession: string | null | undefined, start: number | null = null): PredictionState {
  return useJob<PredictionResult, PredictionJob>(
    accession
      ? () =>
          fetch(`${API_BASE}/api/predicted-structure/${accession}${start ? `?start=${start}` : ""}`).then(readJob)
      : null,
    `${accession}:${start}`
  );
}

/** Structure prédite d'une séquence quelconque, avec la topologie connue si disponible. */
export function useSequencePrediction(
  sequence: string | null | undefined,
  name = "query",
  topology: KnownTopology | null = null,
  start: number | null = null
): PredictionState {
  const segments = topology?.tm_segments.map((s) => `${s.start}-${s.end}`).join(",") ?? "";
  return useJob<PredictionResult, PredictionJob>(
    sequence
      ? () =>
          fetch(`${API_BASE}/api/predicted-structure/sequence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sequence,
              name,
              start,
              ...(topology?.tm_segments.length
                ? {
                    tm_segments: topology.tm_segments.map(({ start, end, label }) => ({ start, end, label })),
                    n_terminus: topology.n_terminus ?? null,
                    tm_source: topology.tm_source,
                  }
                : {}),
            }),
          }).then(readJob)
      : null,
    `seq:${sequence?.length}:${sequence?.slice(0, 50)}:${sequence?.slice(-50)}:${segments}:${topology?.n_terminus}:${start}`
  );
}

// ---------------------------------------------------------------------------
// Comparaison avec une structure expérimentale
// ---------------------------------------------------------------------------

export type ComparisonResult = {
  pdb_id: string;
  chain: string;
  chains: string[];
  /** Chaîne expérimentale superposée, renumérotée en UniProt, dans le repère de la membrane du modèle. */
  pdb: string;
  /** Reste du cristal (autres chaînes, partie fusionnée, ligands), dans le même repère. */
  pdb_others: string;
  other_chains: { chain: string; molecule: string | null; residues: number; fused: boolean }[];
  molecule: string | null;
  experimental_chain: string;
  pairs: number;
  modelled: number;
  coverage: number;
  tm_score: number;
  rmsd_all: number;
  rmsd_close: number | null;
  fraction_close: number;
  fraction_far: number;
  plddt_correlation: number | null;
  residues: { number: number; aa: string; aa_experimental: string; distance: number; plddt: number | null }[];
  regions: {
    kind: PredictedRegion["kind"];
    label: string;
    start: number;
    end: number;
    observed: number;
    length: number;
    mean_distance: number;
    max_distance: number;
    rmsd: number;
    mean_plddt: number | null;
  }[];
  helices: { label: string; tilt_model: number; tilt_experimental: number; tilt_difference: number; rmsd: number }[];
  deviant_regions: { start: number; end: number; mean_distance: number; mean_plddt: number; region: string | null }[];
  mutations: { number: number; model: string; experimental: string }[];
  ligands: {
    ligand: string;
    number: number;
    atoms: number;
    residues: { number: number; aa: string; plddt: number | null }[];
    mean_plddt: number | null;
  }[];
  interpretation: { level: InterpretationNote["level"]; topic: string; title: string; text: string }[];
  method: string;
};

// Écart entre Cα après superposition : rampe ordinale orange (validée, fond clair)
export const DEVIATION_BANDS = [
  { max: 1, color: "#f09868", label: "< 1 Å" },
  { max: 2, color: "#e0662f", label: "1–2 Å" },
  { max: 4, color: "#b4401a", label: "2–4 Å" },
  { max: Infinity, color: "#76260c", label: "> 4 Å" },
] as const;

export const deviationColor = (distance: number) => (DEVIATION_BANDS.find((b) => distance < b.max) ?? DEVIATION_BANDS[3]).color;
