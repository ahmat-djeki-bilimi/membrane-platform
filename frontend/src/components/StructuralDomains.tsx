"use client";

import { useEffect, useState } from "react";
import { Dna, Eye, Loader2, Search } from "lucide-react";
import { API_BASE } from "@/lib/api";
import TopologyDiagram from "@/components/protein/TopologyDiagram";
import DomainArchitecture from "@/components/protein/DomainArchitecture";

type AlphaFoldData = {
  available: boolean;
  sequence?: string;
  sequence_length?: number;
};

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type DomainType =
  | "domain"
  | "repeat"
  | "topological"
  | "transmembrane"
  | "intramembrane"
  | "signal"
  | "region"
  | "motif";

type DomainRegion = HighlightRange & {
  type: DomainType;
  feature_type?: string;
};

type SequenceMotif = HighlightRange & {
  motif: string;
  category: string;
  description: string;
};

// Couleur et libellé par type d'annotation UniProt
const DOMAIN_STYLES: Record<DomainType, { color: string; label: string }> = {
  domain: { color: "#2563eb", label: "Domaine" },
  repeat: { color: "#0891b2", label: "Répétition" },
  transmembrane: { color: "#d97706", label: "Transmembranaire" },
  intramembrane: { color: "#b45309", label: "Intramembranaire" },
  topological: { color: "#64748b", label: "Domaine topologique" },
  signal: { color: "#db2777", label: "Peptide signal" },
  region: { color: "#7c3aed", label: "Région" },
  motif: { color: "#059669", label: "Motif" },
};

export default function StructuralDomains({
  accession,
  alphafold,
  activeRange,
  onFocusRange,
  onClearFocus,
}: {
  accession: string;
  alphafold: AlphaFoldData | null;
  activeSource?: "pdb" | "alphafold";
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
  onClearFocus: () => void;
}) {
  const [domains, setDomains] = useState<DomainRegion[]>([]);
  const [domainLength, setDomainLength] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accession) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/domains/${accession}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        setDomainLength(json.sequence_length || 0);
        setDomains(
          (json.domains || []).map((d: DomainRegion) => ({
            ...d,
            color: DOMAIN_STYLES[d.type]?.color ?? "#64748b",
          }))
        );
      })
      .catch(() => !cancelled && setError("Impossible de joindre le serveur d’analyse."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [accession]);

  const sequence = (alphafold?.sequence || "").toUpperCase();
  const length = domainLength || alphafold?.sequence_length || sequence.length || 0;
  const motifs = scanSequenceMotifs(sequence).slice(0, 24);
  const isActive = (r: HighlightRange) =>
    activeRange?.start === r.start && activeRange?.end === r.end;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <SectionTitle />
        <div className="flex items-center gap-2">
          {activeRange && (
            <button
              onClick={onClearFocus}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
            >
              Réinitialiser la sélection
            </button>
          )}
          <span className="rounded bg-blue-50 px-2.5 py-1 text-[13px] font-semibold text-blue-800">
            {domains.length} annotation{domains.length > 1 ? "s" : ""} · {motifs.length} motif
            {motifs.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-[14px] text-slate-500">
            <Loader2 size={15} className="animate-spin text-blue-600" />
            Chargement des annotations UniProt…
          </div>
        ) : error ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[14px] text-amber-900">
            {error}
          </p>
        ) : domains.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[14px] text-slate-600">
            Aucun domaine ni région n’est annoté dans UniProtKB pour cette entrée.
          </p>
        ) : (
          <>
            {domains.some((d) => d.type === "transmembrane" || d.type === "intramembrane") && (
              <div className="rounded-md border border-slate-200 p-3">
                <h3 className="mb-0.5 text-[15px] font-semibold text-slate-900">Topologie membranaire</h3>
                <p className="mb-2 text-[13px] text-slate-500">
                  Passage de la chaîne à travers la bicouche lipidique d’après les annotations
                  UniProt (segments transmembranaires, régions intramembranaires et domaines
                  topologiques).
                </p>
                <TopologyDiagram regions={domains} length={length} activeRange={activeRange} onSelect={onFocusRange} />
              </div>
            )}

            <div className="rounded-md border border-slate-200 p-3">
              <h3 className="mb-0.5 text-[15px] font-semibold text-slate-900">Architecture des domaines</h3>
              <p className="mb-2 text-[13px] text-slate-500">
                Organisation linéaire de la séquence (1 → {length}) : domaines, segments
                membranaires, motifs et régions annotés.
              </p>
              <DomainArchitecture regions={domains} length={length} activeRange={activeRange} onSelect={onFocusRange} />
            </div>

            <details className="group rounded-md border border-slate-200">
              <summary className="cursor-pointer list-none px-3 py-2 text-[14px] font-semibold text-slate-800 hover:bg-slate-50">
                <span className="mr-1 inline-block transition group-open:rotate-90">▸</span>
                Tableau des annotations ({domains.length})
              </summary>
            <div className="max-h-[320px] overflow-auto border-t border-slate-200">
              <table className="w-full text-[14px]">
                <thead className="sticky top-0 bg-slate-50 text-[13px] text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    <th className="px-3 py-2 text-left font-semibold">Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Positions</th>
                    <th className="px-3 py-2 text-right font-semibold">Longueur</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {domains.map((d, i) => (
                    <tr
                      key={`${d.start}-${d.end}-${i}`}
                      className={`border-t border-slate-100 ${isActive(d) ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                          {DOMAIN_STYLES[d.type]?.label ?? d.feature_type}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-700">{d.label}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {d.start}–{d.end}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{d.end - d.start + 1}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => onFocusRange(d)}
                          className="inline-flex items-center gap-1 rounded border border-blue-200 px-2 py-0.5 text-[13px] text-blue-700 hover:bg-blue-50"
                        >
                          <Eye size={12} />
                          3D
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </details>
            <p className="text-[13px] text-slate-500">
              Source : annotations UniProtKB (numérotation UniProt). La numérotation des
              résidus d’une structure PDB peut différer de celle d’UniProt.
            </p>
          </>
        )}

        <div className="rounded-md border border-slate-200 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Search size={15} className="text-emerald-700" />
            <p className="text-[14px] font-semibold text-slate-900">
              Motifs courts détectés dans la séquence
            </p>
          </div>
          {!sequence ? (
            <p className="text-[14px] text-slate-500">Séquence non disponible.</p>
          ) : motifs.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {motifs.map((motif, index) => (
                <button
                  key={`${motif.start}-${motif.end}-${motif.motif}-${index}`}
                  onClick={() => onFocusRange(motif)}
                  className={`rounded-md border px-3 py-2 text-left text-[13px] transition ${
                    isActive(motif)
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 bg-slate-50 hover:bg-emerald-50"
                  }`}
                  title={motif.description}
                >
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{motif.label}</span>
                    <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px] text-slate-700">
                      {motif.motif}
                    </span>
                  </div>
                  <p className="text-slate-600">
                    {motif.start}–{motif.end} · {motif.category}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[14px] text-slate-500">Aucun motif détecté par ces règles.</p>
          )}
          <p className="mt-2 text-[12px] text-slate-400">
            Motifs consensus (N-glycosylation, NPxY…) : sites potentiels, non vérifiés
            expérimentalement.
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionTitle() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="rounded-md bg-violet-600 p-2 text-white shadow-sm">
        <Dna size={16} />
      </span>
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-violet-700">
          UniProtKB
        </p>
        <h2 className="text-[17px] font-semibold text-slate-900">Domaines et régions annotés</h2>
      </div>
    </div>
  );
}

function scanSequenceMotifs(sequence: string): SequenceMotif[] {
  const motifs: SequenceMotif[] = [];

  const addMotif = (
    start: number,
    end: number,
    label: string,
    motif: string,
    category: string,
    description: string,
    color = "#ef4444"
  ) => {
    motifs.push({
      start,
      end,
      label,
      motif,
      category,
      description,
      color,
    });
  };

  for (let i = 0; i <= sequence.length - 4; i++) {
    const window = sequence.slice(i, i + 4);
    if (
      window[0] === "N" &&
      window[1] !== "P" &&
      (window[2] === "S" || window[2] === "T")
    ) {
      addMotif(
        i + 1,
        i + 3,
        "N-glyco",
        window.slice(0, 3),
        "glycosylation potentielle",
        "Motif N-X-S/T compatible avec une N-glycosylation potentielle.",
        "#ef4444"
      );
    }
  }

  for (let i = 0; i <= sequence.length - 4; i++) {
    const window = sequence.slice(i, i + 4);
    if (window[0] === "N" && window[1] === "P" && window[3] === "Y") {
      addMotif(
        i + 1,
        i + 4,
        "NPxY",
        window,
        "signal d’interaction",
        "Motif NPxY souvent impliqué dans des interactions protéine-protéine.",
        "#dc2626"
      );
    }
  }

  for (let i = 0; i <= sequence.length - 4; i++) {
    const window = sequence.slice(i, i + 4);
    if (window[0] === "P" && window[3] === "P") {
      addMotif(
        i + 1,
        i + 4,
        "PxxP",
        window,
        "motif proline",
        "Motif riche en prolines pouvant participer à des interactions SH3-like.",
        "#f97316"
      );
    }
  }

  for (let i = 0; i <= sequence.length - 8; i++) {
    const window = sequence.slice(i, i + 8);
    const positives = window.split("").filter((aa) => "KRH".includes(aa)).length;
    if (positives >= 5) {
      addMotif(
        i + 1,
        i + 8,
        "Basic patch",
        window,
        "région basique",
        "Patch riche en acides aminés basiques, potentiellement impliqué dans liaison ADN/ARN ou interaction membrane.",
        "#7c3aed"
      );
      i += 7;
    }
  }

  for (let i = 0; i <= sequence.length - 12; i++) {
    const window = sequence.slice(i, i + 12);
    const cysteines = window.split("").filter((aa) => aa === "C").length;
    if (cysteines >= 3) {
      addMotif(
        i + 1,
        i + 12,
        "Cys cluster",
        window,
        "cluster cystéines",
        "Cluster riche en cystéines pouvant indiquer ponts disulfure ou région structurale spécifique.",
        "#0891b2"
      );
      i += 11;
    }
  }

  return motifs;
}
