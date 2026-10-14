// Exécutions des analyses (route /api/runs) : traçabilité, reprise,
// comparaison, rapport PDF et exports. L'historique « Mes analyses » est
// gardé dans ce navigateur : le serveur n'expose aucune liste globale.

import { API_BASE } from "./api";

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export type RunStep = { name: string; detail: string | null; status: RunStatus; started_at: string; duration: number | null; error: string | null; cache_hits: number };

export type RunSource = {
  name: string;
  live_requests: number;
  cached_responses: number;
  failed_requests?: number;
  last_error?: string | null;
  release: string | null;
  release_date: string | null;
  oldest_cache: string | null;
  first_access: string;
};

export type RunInput = { kind: string; id: string } & Record<string, string | number>;

export type RunProvenance = {
  steps: RunStep[];
  sources: RunSource[];
  inputs: RunInput[];
  tools: { name: string; version: string | null; detail: string | null }[];
  duration: number;
  environment: Record<string, string>;
  fingerprint: string;
  methods: RunMethod[];
  declared_inputs: RunInput[];
};

export type RunMethod = { name: string; reference: string; platform_version: number | null };

export type Run = {
  id: string;
  kind: string;
  label: string;
  status: RunStatus;
  error: string | null;
  attempts: number;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  provenance: RunProvenance | null;
  history: { attempt: number; status: string; error: string | null; started_at: string | null; finished_at: string | null; steps: RunStep[] }[];
  parent_id: string | null;
  stale: boolean;
  can_resume: boolean;
  summary: Record<string, string | number | boolean | null>;
  inputs: RunInput[];
  params_digest: Record<string, unknown>;
  tables?: Record<string, string>;
  methods?: RunMethod[];
};

type Diff = { key: string; a: unknown; b: unknown; same: boolean };

export type RunComparison = {
  a: Run;
  b: Run;
  same_kind: boolean;
  same_fingerprint: boolean;
  params: Diff[];
  environment: Diff[];
  sources: { name: string; a: SourceSide; b: SourceSide; same_release: boolean }[];
  steps: { name: string; a: { status: string | null; duration: number | null }; b: { status: string | null; duration: number | null } }[];
  summary: Diff[];
  overlaps: Record<string, { a: number; b: number; shared: number; jaccard: number }>;
};

type SourceSide = { release: string | null; live: number | null; cached: number | null; oldest_cache: string | null };

async function json<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Erreur ${response.status}`);
  return data as T;
}

export const runsApi = {
  list: (ids: string[]) => (ids.length ? fetch(`${API_BASE}/api/runs?ids=${ids.map(encodeURIComponent).join(",")}`).then((r) => json<Run[]>(r)) : Promise.resolve([])),
  get: (id: string) => fetch(`${API_BASE}/api/runs/${encodeURIComponent(id)}`).then((r) => json<Run>(r)),
  resume: (id: string) => fetch(`${API_BASE}/api/runs/${encodeURIComponent(id)}/resume`, { method: "POST" }).then((r) => json<Run>(r)),
  rerun: (id: string) => fetch(`${API_BASE}/api/runs/${encodeURIComponent(id)}/rerun`, { method: "POST" }).then((r) => json<Run>(r)),
  compare: (a: string, b: string) => fetch(`${API_BASE}/api/runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`).then((r) => json<RunComparison>(r)),
};

export const reportUrl = (id: string) => `${API_BASE}/api/runs/${encodeURIComponent(id)}/report.pdf`;
export const jsonUrl = (id: string) => `${API_BASE}/api/runs/${encodeURIComponent(id)}/export.json`;
export const csvUrl = (id: string, table: string) => `${API_BASE}/api/runs/${encodeURIComponent(id)}/export.csv?table=${encodeURIComponent(table)}`;

// ---------------------------------------------------------------------------
// Historique local (« Mes analyses »)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "memprotscope:runs";
const MAX_HISTORY = 300;

export type HistoryEntry = { id: string; kind: string; seen_at: string };

export function readHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

/** Mémorise une tâche lancée ou consultée dans ce navigateur. */
export function rememberRun(id: string, kind: string | undefined) {
  if (typeof window === "undefined" || !id) return;
  try {
    const history = readHistory().filter((e) => e.id !== id);
    history.unshift({ id, kind: kind ?? "inconnu", seen_at: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // Stockage indisponible (navigation privée) : l'historique n'est simplement pas gardé
  }
}

export function forgetRun(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readHistory().filter((e) => e.id !== id)));
  } catch {
    // rien à faire
  }
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<string, string> = {
  queued: "En file d’attente",
  running: "En cours",
  succeeded: "Terminée",
  failed: "En échec",
};

/** Page de l'application où le résultat d'une exécution s'affiche. */
export function resultPath(run: Pick<Run, "id" | "kind" | "params_digest" | "inputs">): string | null {
  const params = run.params_digest as Record<string, unknown>;
  if (run.kind === "explorer") return `/explorateur/${run.id}`;
  if (run.kind === "protein_comparison") return `/comparaison/${run.id}`;
  if (run.kind === "explorer_tree" && typeof params.job === "string") return `/explorateur/${params.job}?tab=phylogenie&arbre=${run.id}`;
  if ((run.kind === "conservation" || run.kind === "structure_prediction") && typeof params.accession === "string") return `/structures/${params.accession}?tab=${run.kind === "conservation" ? "evolution" : "prediction"}`;
  return null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 120) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "medium" }) : "—";
}
