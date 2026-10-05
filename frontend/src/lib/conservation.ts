// Conservation évolutive (route /api/conservation, calcul en file).

import { useEffect, useState } from "react";
import { API_BASE } from "./api";

export type ConservedPosition = {
  position: number;
  residue: string;
  score: number;
  grade: number;
  gap_fraction: number;
  query_residue_frequency: number;
  top_residues: { residue: string; frequency: number }[];
};

export type Homolog = {
  accession: string;
  entry_name: string;
  protein_name: string | null;
  organism: string | null;
  taxon_id: number | null;
  reviewed: boolean;
  length: number | null;
  identity: number;
  coverage: number;
  link?: string;
};

export type ConservationSource = "uniref50" | "mmseqs";

export type MatchedEntry = { uniparc_id: string; accession: string; reviewed: boolean };

export type ConservationResult = {
  accession: string | null;
  name?: string;
  source: ConservationSource;
  method: string;
  cluster_id: string | null;
  cluster_size: number | null;
  sequence_count: number;
  species_count: number | null;
  excluded_count: number;
  length: number;
  query_sequence: string;
  positions: ConservedPosition[];
  summary: {
    mean_score: number | null;
    tm_mean_score: number | null;
    loop_mean_score: number | null;
    tm_segments: { start: number; end: number; label?: string }[];
    regions: {
      kind: string;
      label: string;
      start: number;
      end: number;
      length: number;
      mean_score: number | null;
      side?: string | null;
    }[];
    most_conserved: { position: number; residue: string; score: number }[];
  };
  homologs: Homolog[];
  msa: { accession: string; organism: string; row: string }[];
  tree?: PhyloTree | null;
  warnings: string[];
};

/** Nœud de l'arbre : feuille (`leaf` = indice dans `leaves`) ou nœud interne. */
export type PhyloNode = {
  length: number;
  size: number;
  leaf?: number;
  support?: number | null;
  children?: PhyloNode[];
};

export type PhyloLeaf = {
  id: string;
  organism: string | null;
  taxon_id: number | null;
  identity: number | null;
  is_query: boolean;
  group: string | null;
  lineage: Record<string, string>;
};

export type PhyloTree = {
  method: string;
  bootstrap_replicates: number;
  leaf_count: number;
  max_distance: number;
  saturated_pairs: number;
  group_rank: string | null;
  group_rank_label: string | null;
  groups: { name: string; count: number }[];
  leaves: PhyloLeaf[];
  root: PhyloNode;
  newick: string;
};

// Palette ConSurf : 1 (variable, turquoise) → 9 (conservé, bordeaux)
export const CONSURF_COLORS = [
  "#10c8d1", "#8cffff", "#d7ffff", "#eaffff", "#ffffff",
  "#fcedf4", "#fac9de", "#f07dab", "#a02560",
];

export const gradeColor = (grade: number) => CONSURF_COLORS[Math.min(9, Math.max(1, grade)) - 1];

/** Regroupe les positions consécutives de même grade (coloration 3D). */
export function gradeRanges(positions: ConservedPosition[]) {
  const ranges: { start: number; end: number; grade: number; color: string; label: string }[] = [];
  for (const p of positions) {
    const last = ranges[ranges.length - 1];
    if (last && last.grade === p.grade && last.end === p.position - 1) last.end = p.position;
    else ranges.push({ start: p.position, end: p.position, grade: p.grade, color: gradeColor(p.grade), label: `Grade ${p.grade}` });
  }
  return ranges;
}

type State = {
  status: "idle" | "queued" | "running" | "succeeded" | "failed";
  result: ConservationResult | null;
  error: string | null;
  /** Séquence reconnue comme identique à une entrée UniProt. */
  matched: MatchedEntry | null;
};

const IDLE: State = { status: "idle", result: null, error: null, matched: null };

/** Suit une tâche de calcul jusqu'à son résultat. */
function useJob(start: (() => Promise<{ id: string; status: string; result?: ConservationResult; error?: string; matched_entry?: MatchedEntry | null }>) | null, key: string) {
  const [state, setState] = useState<State>(IDLE);

  useEffect(() => {
    if (!start) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let matched: MatchedEntry | null = null;
    setState({ ...IDLE, status: "queued" });

    const handle = (job: { id: string; status: string; result?: ConservationResult; error?: string }) => {
      if (cancelled) return;
      if (job.status === "succeeded") setState({ status: "succeeded", result: job.result ?? null, error: null, matched });
      else if (job.status === "failed")
        setState({ status: "failed", result: null, error: job.error || "Calcul impossible.", matched });
      else {
        setState({ status: job.status as State["status"], result: null, error: null, matched });
        timer = setTimeout(() => {
          fetch(`${API_BASE}/api/jobs/${job.id}`)
            .then((r) => r.json())
            .then(handle)
            .catch(fail);
        }, 3000);
      }
    };
    const fail = (e?: unknown) =>
      !cancelled &&
      setState({
        ...IDLE,
        status: "failed",
        error: e instanceof Error && e.message ? e.message : "Impossible de joindre le serveur.",
      });

    start()
      .then((job) => {
        matched = job.matched_entry ?? null;
        handle(job);
      })
      .catch(fail);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

async function readJob(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `Erreur ${response.status}`);
  return data;
}

/** Conservation d'une entrée UniProt (orthologues UniRef50 ou recherche étendue). */
export function useConservation(accession: string | null | undefined, source: ConservationSource = "uniref50"): State {
  return useJob(
    accession ? () => fetch(`${API_BASE}/api/conservation/${accession}?source=${source}`).then(readJob) : null,
    `${accession}:${source}`
  );
}

/** Conservation d'une séquence quelconque (reconnue dans UniProt, sinon MMseqs2). */
export function useSequenceConservation(sequence: string | null | undefined, name = "query"): State {
  return useJob(
    sequence
      ? () =>
          fetch(`${API_BASE}/api/conservation/sequence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sequence, name }),
          }).then(readJob)
      : null,
    `seq:${sequence?.length}:${sequence?.slice(0, 50)}:${sequence?.slice(-50)}`
  );
}
