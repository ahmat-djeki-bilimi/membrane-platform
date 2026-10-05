// Appels authentifiés à l'API (jeton de session « Bearer »).

import { API_BASE } from "./api";

const TOKEN_KEY = "memprot:token";

export type User = { id: string; email: string; name: string; created_at: string };

export type SavedAnalysis = {
  id: string;
  kind: "accession" | "sequence" | "structure";
  title: string;
  payload: Record<string, unknown>;
  notes: string;
  created_at: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string | null;
  analysis_count: number;
  analyses?: SavedAnalysis[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Stockage indisponible (navigation privée) : la session dure le temps de la page
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, "Impossible de joindre le serveur.");
  }

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? "Données invalides."
      : data.detail || `Erreur ${response.status}`;
    throw new ApiError(response.status, detail);
  }
  return data as T;
}

export const projectsApi = {
  list: () => apiFetch<Project[]>("/api/projects"),
  get: (id: string) => apiFetch<Project>(`/api/projects/${id}`),
  create: (name: string, description = "") =>
    apiFetch<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name, description }) }),
  update: (id: string, name: string, description: string) =>
    apiFetch<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name, description }) }),
  remove: (id: string) => apiFetch<void>(`/api/projects/${id}`, { method: "DELETE" }),
  saveAnalysis: (
    projectId: string,
    analysis: { kind: SavedAnalysis["kind"]; title: string; payload: Record<string, unknown>; notes?: string }
  ) =>
    apiFetch<SavedAnalysis>(`/api/projects/${projectId}/analyses`, {
      method: "POST",
      body: JSON.stringify(analysis),
    }),
  removeAnalysis: (projectId: string, analysisId: string) =>
    apiFetch<void>(`/api/projects/${projectId}/analyses/${analysisId}`, { method: "DELETE" }),
};
