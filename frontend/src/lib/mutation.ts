// Substitution d'un résidu (route /api/mutation/{accession}?position=…&to=…).

import { API_BASE } from "./api";
import type { FunctionalSite, FunctionalVariant } from "./annotations";

export const AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY";

export const AA_CLASS: Record<string, "hydrophobe" | "polaire" | "chargé +" | "chargé −" | "particulier"> = {
  A: "hydrophobe", V: "hydrophobe", I: "hydrophobe", L: "hydrophobe", M: "hydrophobe", F: "hydrophobe", W: "hydrophobe", C: "hydrophobe",
  S: "polaire", T: "polaire", N: "polaire", Q: "polaire", Y: "polaire", H: "polaire",
  K: "chargé +", R: "chargé +", D: "chargé −", E: "chargé −",
  G: "particulier", P: "particulier",
};

export const CLASS_COLORS: Record<string, string> = {
  hydrophobe: "#d97706",
  polaire: "#059669",
  "chargé +": "#2563eb",
  "chargé −": "#dc2626",
  particulier: "#7c3aed",
};

type Side = { aa: string; name: string; class: string; hydropathy: number; volume: number; charge: number };

export type Hypothesis = { kind: "attention" | "modere" | "incertain" | "documente"; title: string; text: string; test: string | null };

export type Contact = { resi: number; aa: string; distance: number; kinds: string[]; at_risk: string[]; plddt: number | null };

export type MutationAnalysis = {
  accession: string;
  position: number;
  wild: string;
  mutant: string;
  label: string;
  context: string;
  properties: {
    wild: Side;
    mutant: Side;
    delta_hydropathy: number;
    delta_volume: number;
    delta_charge: number;
    class_change: boolean;
    blosum62: number;
    grantham: number;
    grantham_class: string;
  };
  conservation: {
    status: string;
    error?: string | null;
    available?: boolean;
    grade?: number;
    score?: number;
    gap_fraction?: number;
    wild_frequency?: number;
    observed?: { residue: string; frequency: number }[];
    sequences?: number;
    method?: string;
  };
  mutant_homolog_frequency: number | null;
  environment:
    | { available: false; reason: string }
    | {
        available: true;
        model_id: string;
        plddt: number | null;
        reliable: boolean;
        neighbours: number;
        burial: "enfoui" | "intermédiaire" | "exposé";
        secondary: string;
        contacts: Contact[];
      };
  membrane: { zone: string; segment?: string; depth?: number; core?: boolean; side?: string; evidence_label?: string };
  annotations: {
    at_site: (FunctionalSite & { ligands?: string[] })[];
    nearby_sites: (FunctionalSite & { proximity: "3D" | "séquence" })[];
    ptms: { type: string; description: string | null; evidence_label: string; experimental: boolean }[];
    documented_variants: FunctionalVariant[];
    same_substitution: FunctionalVariant[];
    domains: { database: string; accession: string; name: string }[];
  };
  hypotheses: Hypothesis[];
  profile: { aa: string; blosum62: number; grantham: number; delta_hydropathy: number; delta_volume: number; homolog_frequency: number | null }[];
  limits: string[];
};

export async function fetchMutation(accession: string, position: number, to: string): Promise<MutationAnalysis> {
  const response = await fetch(`${API_BASE}/api/mutation/${encodeURIComponent(accession)}?position=${position}&to=${to}`);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Erreur ${response.status}`);
  return data;
}
