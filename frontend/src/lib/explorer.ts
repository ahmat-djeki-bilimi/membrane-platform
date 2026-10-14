// Membrane Evolution & Function Explorer (route /api/explorer, calcul en file).

import { API_BASE } from "./api";
import type { ConservationResult, ConservedPosition, Homolog, PhyloTree, TreeModel } from "./conservation";
import { readJob, useJob, type Job, type JobState } from "./jobs";
import type { PredictedHelix, TopologySource } from "./prediction";

export type Zone = "core" | "interface_out" | "interface_in" | "out" | "in" | "membrane" | "loop";

export type ExplorerPosition = ConservedPosition & {
  region: string | null;
  region_kind: string | null;
  zone: Zone;
  z?: number | null;
  neighbours?: number;
  burial?: "enfoui" | "intermédiaire" | "exposé";
  plddt?: number;
  couplings: number;
  network?: number;
  /** Secteur SCA de la position. */
  sector?: number;
};

export type CoevolutionPair = {
  i: number;
  j: number;
  score: number;
  z: number;
  region_i: string | null;
  region_j: string | null;
  kind: "inter_helix" | "intra_helix" | "tm_loop" | "loops";
  distance?: number | null;
  contact?: boolean;
  confident?: boolean;
  /** Part des sous-échantillons (70 % des séquences) qui retrouvent la paire parmi les L/5 premières. */
  stability?: number;
  /** Score supérieur au meilleur score obtenu sur les alignements mélangés. */
  above_null?: boolean;
};

export type CheckStatus = "ok" | "attention" | "probleme";

export type CoevolutionDiagnostics = {
  sequences: number;
  neff: number;
  neff_per_length: number;
  largest_cluster: number;
  excluded_columns: number;
  mean_gap: number;
  pc1_share: number;
  pc3_share: number;
  dominant_group: { rank: string; name: string; share: number; groups: number } | null;
  checks: { id: string; label: string; value: string; status: CheckStatus; text: string }[];
  status: CheckStatus;
};

export type MipRobustness = {
  subsamples: number;
  fraction: number;
  top_count: number;
  overlaps: number[];
  mean_overlap: number | null;
  stable_pairs: number | null;
  shuffles: number;
  null_max_score: number | null;
  above_null: number | null;
  skipped: boolean;
  note: string | null;
};

export type ContactBenchmark = {
  curve: [number, number][];
  by_separation: { label: string; count: number; precision: number }[];
  confident_count: number;
  confident_precision: number | null;
  top_precision: number;
  enrichment: number | null;
  structure_note: string;
};

export type Histogram = { edges: number[]; counts: number[] };

export type Coevolution = {
  method: string;
  sequence_count: number;
  neff: number;
  length: number;
  valid_columns: number;
  min_separation: number;
  reliability: { level: "insuffisante" | "faible" | "moyenne" | "bonne"; neff_per_length: number; text: string };
  pairs: CoevolutionPair[];
  strong_pairs: number;
  precision: { label: string; count: number; precision: number }[];
  random_precision?: number;
  /** Contrôles (version 10 et suivantes). */
  parameters?: Record<string, number>;
  distribution?: Histogram & { pairs: number; mean: number; std: number; above_z3: number; above_z5: number };
  diagnostics?: CoevolutionDiagnostics;
  robustness?: MipRobustness;
  benchmark?: ContactBenchmark | null;
};

export type Network = {
  id: number;
  residues: { position: number; residue: string; grade: number }[];
  size: number;
  links: [number, number][];
  helices: string[];
  mean_grade: number;
  contacts: number;
  with_distance: number;
};

export type Sector = {
  id: number;
  component: number;
  positions: number[];
  residues: { position: number; residue: string; grade: number; weight: number; zone: Zone | null }[];
  size: number;
  helices: string[];
  mean_grade: number;
  zones: Partial<Record<Zone, number>>;
  /** Distance moyenne entre membres / distance moyenne de la protéine (< 1 : groupe compact en 3D). */
  compactness: number | null;
  /** Conservation contre covariance (version 10 et suivantes). */
  mean_conservation?: number;
  conservation_percentile?: number;
  loading_conservation_r?: number | null;
  covariance_z?: number | null;
  stability?: number | null;
  stability_label?: "stable" | "partiellement stable" | "instable" | null;
  signal?: "covariance collective" | "dominé par la conservation" | "indéterminé";
};

export type Sca = {
  method: string;
  sequence_count: number;
  neff: number;
  valid_columns: number;
  eigenvalues: number[];
  random_threshold: number;
  significant_modes: number;
  components: number;
  sectors: Sector[];
  reliability?: Coevolution["reliability"];
  parameters?: Record<string, number>;
  first_mode_conservation_r?: number | null;
  loading_histograms?: Histogram[];
  stability_test?: { subsamples: number; fraction: number; sector_counts: number[]; skipped: boolean; note: string | null };
};

export type MethodComparison = {
  mip_count: number;
  sca_count: number;
  shared: { position: number; residue: string; sector: number }[];
  mip_only: number;
  sca_only: number;
  jaccard: number | null;
  pairs_within_sector: number;
  strong_pairs: number;
  zones: Partial<Record<Zone, { mip: number; sca: number; both: number }>>;
  mip_mean_grade: number | null;
  sca_mean_grade: number | null;
  per_sector: { id: number; size: number; shared: number }[];
};

export type Candidate = {
  position: number;
  residue: string;
  grade: number;
  zone: Zone;
  region: string | null;
  score: number;
  category: "Fonctionnel" | "Structural" | "Interface" | "Réseau coévolutif" | "Conservé";
  couplings: number;
  reasons: string[];
};

export type ExplorerStructure = {
  source: "AlphaFold" | "ESMFold";
  model_id?: string | null;
  method: string;
  pdb: string;
  embedded: boolean;
  membrane: {
    thickness: number;
    at_search_limit: boolean;
    side_method: "topology" | "positive_inside";
    kr_inside: number;
    kr_outside: number;
    n_terminus: "in" | "out";
  } | null;
  helices: PredictedHelix[];
  window: { start: number; end: number; complete: boolean; max_length: number } | null;
  mean_plddt: number | null;
  tm_mean_plddt: number | null;
  contacts: [number, number][];
};

export type OpmSummary = {
  pdb_id: string | null;
  opm_pdb_id?: string;
  url?: string;
  name?: string;
  type?: string;
  family?: string;
  superfamily?: string;
  membrane?: string;
  hydrophobic_thickness?: number | null;
  tilt_angle?: number | null;
  n_terminus?: "in" | "out" | null;
  structure_count: number;
};

export type ExplorerResult = Omit<ConservationResult, "positions" | "accession" | "source" | "cluster_id" | "cluster_size" | "excluded_count"> & {
  version: number;
  positions: ExplorerPosition[];
  reference: {
    id: string;
    header: string;
    index: number;
    accession: string | null;
    accession_origin: "user" | "header" | "uniparc" | null;
    protein_name: string | null;
    organism: string | null;
    length: number;
  };
  input: {
    sequence_count: number;
    kept: number;
    imported_kept: number;
    mmseqs_added: number;
    expanded: boolean;
    excluded: { id: string; reason: string }[];
    prealigned: boolean;
    /** Homologues retenus avant la sélection de l’utilisateur. */
    pool?: number;
    /** Analyse restreinte aux homologues choisis dans l’onglet Homologues. */
    selection?: boolean;
  };
  /** Homologues retenus mais écartés par l’utilisateur (avec leur ligne alignée). */
  unselected?: (Homolog & { row: string })[];
  /** Contrôle qualité de l’alignement (version 7 et suivantes). */
  qc?: AlignmentQuality;
  /** Comparaison DeepTMHMM / UniProt / structure 3D / hydropathie (version 9 et suivantes). */
  topology_comparison?: TopologyComparison;
  /** Orientation calculée : épaisseur utilisée et limites (version 9 et suivantes). */
  orientation?: OrientationReport;
  topology: {
    source: TopologySource;
    segments: { start: number; end: number; label: string }[];
    n_terminus: "in" | "out" | null;
    predicted_type: string | null;
    signal_peptide: { start: number; end: number } | null;
    deeptmhmm_status: string | null;
  };
  structure: ExplorerStructure | null;
  opm: OpmSummary | null;
  coevolution: Coevolution | null;
  networks: Network[];
  sca?: Sca | null;
  comparison?: MethodComparison | null;
  candidates: Candidate[];
  most_variable: { position: number; residue: string; score: number }[];
  interpretation: { topic: string; title: string; text: string }[];
};

/** Réglages du contrôle qualité (absents : aucun filtre). Fractions de 0 à 1. */
export type QualityParams = {
  min_coverage?: number | null;
  max_internal_gap?: number | null;
  max_column_gaps?: number | null;
  mask_poor_regions?: boolean;
};

export type SequenceQuality = {
  accession: string;
  coverage: number;
  start: number | null;
  end: number | null;
  longest_internal_gap: number;
  internal_gaps: number;
  removed: boolean;
};

export type PoorRegion = { start: number; end: number; length: number; mean_gap: number; mean_similarity: number; reason: string };

export type AlignmentQuality = {
  params: Required<QualityParams>;
  /** Une valeur par position de la référence (indice 0 = position 1). */
  columns: { gap_fraction: number[]; identity: number[]; similarity: number[]; masked: boolean[]; reasons: (string | null)[] };
  sequences: SequenceQuality[];
  /** Séquences écartées comme incomplètes, avec leur ligne alignée. */
  removed: (Homolog & { row: string; reasons: string[] })[];
  poor_regions: PoorRegion[];
  diversity: {
    mean_pairwise_identity: number | null;
    median_identity_to_reference: number | null;
    neff: number;
    neff_per_length: number;
    sampled: number;
  };
  mapping: { columns: number; reference_length: number; exact: boolean; source_columns: number[] | null };
  summary: {
    sequences: number;
    kept: number;
    removed: number;
    masked_columns: number;
    high_gap_columns: number;
    mean_gap: number | null;
    median_coverage: number | null;
    poor_region_positions: number;
  };
};

export type TopologySourceId = "deeptmhmm" | "uniprot" | "structure" | "kd";
export type UniprotEvidence = "experimental" | "structure" | "similarity" | "inference" | "predicted" | "unknown";
export type SourceSegment = { start: number; end: number; label?: string; evidence?: UniprotEvidence; evidence_label?: string; mean_plddt?: number | null };

export type TopologyComparison = {
  /** Source des segments retenus pour l’analyse. */
  chosen: TopologySource;
  sources: { id: TopologySourceId; label: string; kind: string; count: number; n_terminus: "in" | "out" | null; note: string | null; segments: SourceSegment[] }[];
  /** Segments communs : segments des sources qui se recouvrent. */
  segments: {
    id: number;
    label: string;
    start: number;
    end: number;
    in_chosen: boolean;
    sources: Partial<Record<TopologySourceId, SourceSegment[]>>;
    shift: number;
    uniprot_evidence: UniprotEvidence | null;
    structure_plddt: number | null;
    helix_crossing: "full" | "short" | "partial" | null;
    confidence: "forte" | "moyenne" | "faible";
    confidence_reason: string;
    notes: string[];
  }[];
  divergences: { severity: "majeure" | "mineure"; position: number | null; text: string }[];
  summary: { segments: number; strong: number; major_divergences: number; minor_divergences: number };
};

export type OrientationReport = {
  status: "calculée" | "indisponible";
  label: string;
  thickness: number | null;
  thickness_method?: string;
  at_search_limit?: boolean;
  side_method?: "topology" | "positive_inside";
  n_terminus?: "in" | "out";
  limits: string[];
  opm: {
    pdb_id: string;
    thickness: number | null;
    tilt: number | null;
    n_terminus: "in" | "out" | null;
    thickness_difference: number | null;
    n_terminus_agrees: boolean | null;
  } | null;
};

/** Version actuelle du calcul (METHOD_VERSION du backend) : les analyses plus anciennes peuvent être recalculées. */
export const EXPLORER_VERSION = 10;

export type ExplorerRequest = {
  fasta: string;
  reference: number;
  accession?: string | null;
  expand: boolean;
  /** Homologues à conserver (absent : tous). */
  keep?: string[] | null;
  /** Contrôle qualité de l’alignement. */
  qc?: QualityParams | null;
};

export type ExplorerJob = Job<ExplorerResult> & {
  kind?: string;
  params?: { fasta?: string; expand?: boolean; reference?: number; accession?: string | null; keep?: string[]; qc?: QualityParams };
  sequence_count?: number;
  created_at?: string;
};

/** Soumet une famille à analyser ; renvoie la tâche (identifiant à suivre). */
export async function submitExplorer(request: ExplorerRequest): Promise<ExplorerJob> {
  const response = await fetch(`${API_BASE}/api/explorer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return readJob(response);
}

/** Suit une analyse par l'identifiant de sa tâche (conservé dans l'adresse de la page). */
export function useExplorerJob(jobId: string | null): JobState<ExplorerResult, ExplorerJob> {
  return useJob<ExplorerResult, ExplorerJob>(
    jobId ? () => fetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}`).then(readJob) : null,
    jobId ?? ""
  );
}

/** Nombre maximal de séquences d'un arbre choisi (MAX_TREE_SELECTION du backend). */
export const MAX_TREE_SELECTION = 200;

export type TreeJobResult = { parent: string; ids: string[]; missing: number; tree: PhyloTree | null };

/** Arbre de la référence et des homologues choisis (calcul en file, à partir de l'alignement de l'analyse). */
export async function submitTree(jobId: string, ids: string[], model: TreeModel): Promise<Job<TreeJobResult>> {
  const response = await fetch(`${API_BASE}/api/explorer/${encodeURIComponent(jobId)}/tree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, model }),
  });
  return readJob(response);
}

/** Suit un arbre choisi par l'identifiant de sa tâche (gardé dans l'adresse de la page). */
export function useTreeJob(treeJobId: string | null): JobState<TreeJobResult> {
  return useJob<TreeJobResult>(
    treeJobId ? () => fetch(`${API_BASE}/api/jobs/${encodeURIComponent(treeJobId)}`).then(readJob) : null,
    treeJobId ?? ""
  );
}

export type HomologFasta = {
  accession: string;
  protein_name: string;
  organism: string | null;
  cluster_id: string | null;
  homolog_count: number;
  fasta: string;
};

export async function fetchHomologFasta(accession: string): Promise<HomologFasta> {
  const response = await fetch(`${API_BASE}/api/explorer/homologs/${encodeURIComponent(accession.trim())}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `Erreur ${response.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Lecture rapide du FASTA dans le navigateur (aperçu avant envoi)
// ---------------------------------------------------------------------------

export type FastaPreview = {
  records: { header: string; length: number; aligned: boolean }[];
  prealigned: boolean;
  error: string | null;
};

export function previewFasta(text: string): FastaPreview {
  const records: { header: string; raw: string }[] = [];
  let current: { header: string; raw: string } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    if (line.startsWith(">")) {
      current = { header: line.slice(1).trim() || `sequence_${records.length + 1}`, raw: "" };
      records.push(current);
    } else if (!current) {
      return { records: [], prealigned: false, error: "Chaque séquence doit commencer par une ligne « > nom »." };
    } else {
      current.raw += line.replace(/[^A-Za-z\-.]/g, "");
    }
  }
  const kept = records.filter((r) => r.raw.replace(/[-.]/g, "").length > 0);
  const prealigned = kept.length > 1 && new Set(kept.map((r) => r.raw.length)).size === 1 && kept.some((r) => /[-.]/.test(r.raw));
  return {
    records: kept.map((r) => ({ header: r.header, length: r.raw.replace(/[-.]/g, "").length, aligned: /[-.]/.test(r.raw) })),
    prealigned,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Zones et couleurs
// ---------------------------------------------------------------------------

export const ZONES: Record<Zone, { label: string; color: string }> = {
  core: { label: "Cœur hydrophobe", color: "#d97706" },
  interface_out: { label: "Interface externe", color: "#f43f5e" },
  interface_in: { label: "Interface cytoplasmique", color: "#3b82f6" },
  out: { label: "Côté externe", color: "#fda4af" },
  in: { label: "Côté cytoplasmique", color: "#93c5fd" },
  membrane: { label: "Segment transmembranaire", color: "#d97706" },
  loop: { label: "Hors membrane", color: "#cbd5e1" },
};

export const CATEGORY_COLORS: Record<Candidate["category"], string> = {
  Fonctionnel: "#dc2626",
  Structural: "#7c3aed",
  Interface: "#0891b2",
  "Réseau coévolutif": "#059669",
  Conservé: "#a02560",
};

export const PAIR_KINDS: Record<CoevolutionPair["kind"], string> = {
  inter_helix: "Entre deux hélices",
  intra_helix: "Dans une hélice",
  tm_loop: "Hélice – boucle",
  loops: "Boucles",
};

export const TOPOLOGY_SOURCES: Record<TopologySource, string> = {
  deeptmhmm: "DeepTMHMM",
  uniprot: "UniProt (annotations)",
  kd: "Estimation Kyte-Doolittle",
  user: "Topologie fournie",
};

export const SECTOR_COLORS = ["#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777"];

export const NETWORK_COLORS = ["#059669", "#7c3aed", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#b45309", "#0d9488", "#be123c", "#2563eb", "#a16207"];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(header: string[], rows: unknown[][]) {
  return [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\n") + "\n";
}

export function residuesCsv(result: ExplorerResult) {
  const candidates = new Map(result.candidates.map((c) => [c.position, c]));
  return toCsv(
    ["position", "residu", "grade", "score_JS", "gaps", "colonne_masquee", "region", "zone", "z_A", "enfouissement", "pLDDT", "couplages", "reseau", "secteur_SCA", "candidat", "raisons"],
    result.positions.map((p) => {
      const c = candidates.get(p.position);
      return [
        p.position,
        p.residue,
        p.grade,
        p.score,
        p.gap_fraction,
        p.masked ? "oui" : "non",
        p.region,
        ZONES[p.zone]?.label ?? p.zone,
        p.z ?? "",
        p.burial ?? "",
        p.plddt ?? "",
        p.couplings,
        p.network ?? "",
        p.sector ?? "",
        c ? c.category : "",
        c ? c.reasons.join(" | ") : "",
      ];
    })
  );
}

export function pairsCsv(pairs: CoevolutionPair[]) {
  return toCsv(
    ["i", "j", "score_APC", "z", "region_i", "region_j", "type", "distance_A", "contact"],
    pairs.map((p) => [p.i, p.j, p.score, p.z, p.region_i, p.region_j, PAIR_KINDS[p.kind], p.distance ?? "", p.contact === undefined ? "" : p.contact ? "oui" : "non"])
  );
}

export function alignmentFasta(result: ExplorerResult) {
  const lines = [`>${result.reference.id}`, result.query_sequence];
  for (const row of result.msa) lines.push(`>${row.accession}${row.organism && row.organism !== row.accession ? ` ${row.organism}` : ""}`, row.row);
  return lines.join("\n") + "\n";
}

/** PDB orienté avec le grade de conservation (1–9) dans la colonne B-factor (PyMOL, ChimeraX). */
export function pdbWithGrades(pdb: string, positions: ExplorerPosition[]) {
  const grade = new Map(positions.map((p) => [p.position, p.grade]));
  return pdb
    .split("\n")
    .map((line) => {
      if (!line.startsWith("ATOM")) return line;
      const g = grade.get(parseInt(line.slice(22, 26), 10));
      return g === undefined ? line : line.slice(0, 60) + g.toFixed(2).padStart(6) + line.slice(66);
    })
    .join("\n");
}
