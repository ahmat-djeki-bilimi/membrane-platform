// Annotation fonctionnelle (route /api/annotations/{accession}) : InterPro,
// Gene Ontology, sites et variants, avec la nature de chaque preuve.

import { useEffect, useState } from "react";
import { API_BASE } from "./api";

export type Reference = { source: string; id: string };

type Evidence = { evidence: string; evidence_label: string; experimental: boolean };

export type InterProEntry = {
  database: string;
  database_label: string;
  accession: string;
  name: string;
  type: string | null;
  integrated: string | null;
  locations: { start: number; end: number }[];
  evidence: string;
  experimental: false;
  link: string;
};

export type GoTerm = Evidence & {
  id: string;
  aspect: "F" | "P" | "C";
  aspect_label: string;
  name: string;
  evidence_code: string;
  assigned_by: string | null;
  link: string;
};

export type FunctionalSite = Evidence & {
  type: "Résidu catalytique" | "Site de liaison" | "Site fonctionnel";
  start: number;
  end: number;
  description: string | null;
  ligand: string | null;
  ligand_id: string | null;
  references: Reference[];
};

export type FunctionalVariant = Evidence & {
  kind: "Mutagenèse dirigée" | "Variant naturel";
  start: number;
  end: number;
  original: string | null;
  alternatives: string[];
  description: string | null;
  functional: boolean;
  disease: boolean;
  dbsnp: string | null;
  references: Reference[];
};

export type FunctionalAnnotation = {
  accession: string;
  length: number;
  uniprot_status: string;
  reviewed: boolean;
  interpro: { available: boolean; error?: string; entries: InterProEntry[] };
  go: GoTerm[];
  sites: FunctionalSite[];
  variants: FunctionalVariant[];
  summary: {
    go: { total: number; experimental: number };
    sites: { total: number; experimental: number };
    catalytic: number;
    binding: number;
    variants: { total: number; experimental: number };
    functional_variants: number;
    signatures: number;
    databases: string[];
  };
  sources: { name: string; detail: string; url: string }[];
};

const requests = new Map<string, Promise<FunctionalAnnotation>>();

export function fetchAnnotations(accession: string): Promise<FunctionalAnnotation> {
  if (!requests.has(accession)) {
    const request = fetch(`${API_BASE}/api/annotations/${encodeURIComponent(accession)}`).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || `Erreur ${r.status}`);
      return data as FunctionalAnnotation;
    });
    request.catch(() => requests.delete(accession));
    requests.set(accession, request);
  }
  return requests.get(accession)!;
}

export function useAnnotations(accession: string | null | undefined) {
  const [state, setState] = useState<{ accession: string | null; data: FunctionalAnnotation | null; error: string | null }>({ accession: null, data: null, error: null });
  useEffect(() => {
    if (!accession) return;
    let cancelled = false;
    fetchAnnotations(accession)
      .then((data) => !cancelled && setState({ accession, data, error: null }))
      .catch((e) => !cancelled && setState({ accession, data: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [accession]);
  const current = state.accession === accession;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: !!accession && !current };
}

/** Lien vers une référence citée (PubMed, PDB…). */
export function referenceUrl(ref: Reference): string | null {
  if (ref.source === "PubMed") return `https://pubmed.ncbi.nlm.nih.gov/${ref.id}/`;
  if (ref.source === "PDB") return `https://www.rcsb.org/structure/${ref.id}`;
  if (ref.source === "UniProtKB") return `https://www.uniprot.org/uniprotkb/${ref.id}/entry`;
  return null;
}

/** Libellé d'un changement d'acide aminé (D79N, ou D79del si aucune alternative). */
export function variantLabel(v: FunctionalVariant): string {
  const position = v.start === v.end ? `${v.start}` : `${v.start}-${v.end}`;
  return `${v.original ?? ""}${position}${v.alternatives.length ? v.alternatives.join("/") : "del"}`;
}
