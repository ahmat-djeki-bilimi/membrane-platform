// Analyse d'un modèle AlphaFold (route /api/alphafold/{accession}/analysis) :
// protéines sans structure expérimentale dans le PDB.

import { useEffect, useState } from "react";
import { API_BASE } from "./api";

export type ModelMapping = {
  status: "exacte" | "version" | "differences" | "partielle";
  text: string;
  model_residues: number;
  uniprot_length: number | null;
  model_sequence_length: number | null;
  first: number | null;
  last: number | null;
  numbering_gaps: number;
  identical: number;
  mismatches: { position: number; model: string; uniprot: string }[];
  outside: number[];
  version_changed: boolean;
  checked_against: string;
};

export type RamaSummary = {
  favored_percent: number | null;
  allowed_percent: number | null;
  outliers_percent: number | null;
  status: string;
  interpretation: string;
};

export type ModelPocket = {
  id: number;
  volume: number;
  burial: number;
  center: [number, number, number];
  residues: number[];
  residue_labels: string[];
  mean_plddt: number | null;
  reliable: boolean;
  hydrophobic_fraction: number | null;
  charged_fraction: number | null;
  in_membrane: boolean;
  score: number;
  status: string;
  sites: { type: string; position: number; description: string; confirmed: boolean }[];
};

export type AnnotatedSite = {
  type: string;
  start: number;
  end: number;
  description: string;
  evidence: string;
  evidence_label: string;
  confirmed: boolean;
  status: string;
  pockets: number[];
  mean_plddt: number | null;
};

export type ModelAnalysis = {
  accession: string;
  available: boolean;
  error?: string;
  model_id?: string;
  model_version?: number;
  kind?: string;
  experimental?: false;
  mapping: ModelMapping;
  confidence: {
    mean_plddt: number | null;
    bands: { very_high?: number; confident?: number; low?: number; very_low?: number };
    low_regions: { start: number; end: number; length: number }[];
    per_residue: [number, number][];
  };
  geometry: {
    ramachandran: RamaSummary;
    ramachandran_confident: RamaSummary;
    outliers_confident: { resi: number; resn: string; phi: number; psi: number }[];
    helix_fraction: number;
    strand_fraction: number;
    secondary: string;
    radius_of_gyration: number | null;
    expected_globular_rg: number | null;
  };
  contacts: {
    cutoff: number;
    min_separation: number;
    total: number;
    long_range: number;
    confident: number;
    per_residue: number;
    relative_contact_order: number | null;
    most_connected: { resi: number; contacts: number }[];
    /** [i, j, pLDDT minimal des deux résidus] */
    pairs: [number, number, number][];
  };
  pockets: { method: string; parameters: Record<string, string | number>; pockets: ModelPocket[]; detected: number };
  sites: AnnotatedSite[];
  limits: string[];
};

// Une seule requête par entrée, partagée par les onglets Site actif et PDB / AlphaFold
const requests = new Map<string, Promise<ModelAnalysis>>();

export function fetchModelAnalysis(accession: string): Promise<ModelAnalysis> {
  if (!requests.has(accession)) {
    const request = fetch(`${API_BASE}/api/alphafold/${encodeURIComponent(accession)}/analysis`).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || `Erreur ${r.status}`);
      return data as ModelAnalysis;
    });
    request.catch(() => requests.delete(accession));
    requests.set(accession, request);
  }
  return requests.get(accession)!;
}

export function useModelAnalysis(accession: string | null) {
  const [state, setState] = useState<{ accession: string | null; data: ModelAnalysis | null; error: string | null }>({
    accession: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!accession) return;
    let cancelled = false;
    fetchModelAnalysis(accession)
      .then((data) => !cancelled && setState({ accession, data, error: data.available ? null : data.error ?? "Modèle indisponible." }))
      .catch((e) => !cancelled && setState({ accession, data: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [accession]);
  const current = state.accession === accession;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: !!accession && !current };
}

/** Plages contiguës d'une liste de positions (surlignage 3D). */
export function toRanges(positions: number[]): { start: number; end: number }[] {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const ranges: { start: number; end: number }[] = [];
  for (const p of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && p === last.end + 1) last.end = p;
    else ranges.push({ start: p, end: p });
  }
  return ranges;
}
