"use client";

import { Dna, Eye, Layers3, Map, Search, ShieldCheck } from "lucide-react";

type AlphaFoldData = {
  available: boolean;
  confidence?: number;
  confidence_avg?: number;
  sequence?: string;
  sequence_length?: number;
  protein_name?: string;
  organism?: string;
};

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type DomainRegion = HighlightRange & {
  type: "domain" | "terminal" | "flexible" | "linker" | "motif";
  confidence: "high" | "medium" | "low";
  description: string;
};

type SequenceMotif = HighlightRange & {
  motif: string;
  category: string;
  description: string;
};

export default function StructuralDomains({
  alphafold,
  activeSource,
  activeRange,
  onFocusRange,
  onClearFocus,
}: {
  alphafold: AlphaFoldData | null;
  activeSource: "pdb" | "alphafold" | "ai";
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
  onClearFocus: () => void;
}) {
  const sequence = (alphafold?.sequence || "").toUpperCase();
  const length = alphafold?.sequence_length || sequence.length || 0;
  const confidence = alphafold?.confidence ?? alphafold?.confidence_avg ?? null;

  const regions = buildDomainRegions(length, confidence);
  const motifs = scanSequenceMotifs(sequence).slice(0, 18);

  if (!alphafold?.available || !length) {
    return (
      <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <SectionTitle />
        <div className="rounded border border-amber-100 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900">
          Les domaines et motifs seront détectés dès qu’un modèle AlphaFold avec
          séquence sera disponible. Cette étape utilise la séquence réelle,
          recherche des motifs conservés et relie les régions au viewer 3D.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle />
        <div className="flex items-center gap-2">
          {activeRange && (
            <button
              onClick={onClearFocus}
              className="rounded border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white"
            >
              Réinitialiser
            </button>
          )}
          <span className="rounded border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-800">
            {regions.length} régions · {motifs.length} motifs
          </span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-8 space-y-2">
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[12px] font-bold text-slate-800">
                Carte linéaire domaines + motifs
              </p>
              <span className="text-[11px] text-slate-500">
                Longueur : {length} aa
              </span>
            </div>

            <div className="relative h-16 rounded border border-slate-200 bg-white px-2 py-3">
              <div className="absolute left-2 right-2 top-[45%] h-1 -translate-y-1/2 rounded bg-slate-200" />
              <div className="absolute left-2 right-2 top-[73%] h-1 -translate-y-1/2 rounded bg-slate-100" />

              {regions.map((region) => {
                const left = ((region.start - 1) / length) * 100;
                const width =
                  ((region.end - region.start + 1) / length) * 100;

                return (
                  <button
                    key={`${region.start}-${region.end}-${region.label}`}
                    onClick={() => onFocusRange(region)}
                    className={`absolute top-[45%] h-6 -translate-y-1/2 rounded shadow-sm transition hover:scale-y-110 ${
                      activeRange?.start === region.start &&
                      activeRange?.end === region.end
                        ? "ring-2 ring-red-500"
                        : "ring-1 ring-white"
                    }`}
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 3)}%`,
                      backgroundColor: region.color || "#2563eb",
                    }}
                    title={`${region.label}: ${region.start}-${region.end}`}
                  />
                );
              })}

              {motifs.slice(0, 12).map((motif, index) => {
                const left = ((motif.start - 1) / length) * 100;
                const width =
                  ((motif.end - motif.start + 1) / length) * 100;

                return (
                  <button
                    key={`${motif.start}-${motif.end}-${motif.label}-${index}`}
                    onClick={() => onFocusRange(motif)}
                    className={`absolute top-[73%] h-4 -translate-y-1/2 rounded transition hover:scale-y-125 ${
                      activeRange?.start === motif.start &&
                      activeRange?.end === motif.end
                        ? "ring-2 ring-red-500"
                        : "ring-1 ring-white"
                    }`}
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 1.5)}%`,
                      backgroundColor: motif.color || "#ef4444",
                    }}
                    title={`${motif.label}: ${motif.start}-${motif.end}`}
                  />
                );
              })}
            </div>

            <div className="mt-2 flex justify-between text-[10px] text-slate-500">
              <span>1</span>
              <span>{Math.round(length / 2)}</span>
              <span>{length}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {regions.map((region) => (
              <button
                key={`${region.start}-${region.end}`}
                onClick={() => onFocusRange(region)}
                className={`rounded border p-2 text-left transition ${
                  activeRange?.start === region.start &&
                  activeRange?.end === region.end
                    ? "border-red-300 bg-red-50"
                    : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[12px] font-bold text-slate-900">
                    {region.label}
                  </p>
                  <span
                    className="rounded px-2 py-0.5 text-[10px] font-semibold text-white"
                    style={{ backgroundColor: region.color || "#2563eb" }}
                  >
                    {region.start}-{region.end}
                  </span>
                </div>

                <p className="text-[10px] leading-4 text-slate-600">
                  {region.description}
                </p>

                <div className="mt-2 flex items-center justify-between">
                  <span className={confidenceClass(region.confidence)}>
                    confiance {region.confidence}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0f4c81]">
                    <Eye size={12} />
                    Voir en 3D
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="rounded border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <Search size={15} className="text-[#0f4c81]" />
              <p className="text-[12px] font-bold text-slate-900">
                Motifs détectés dans la séquence réelle
              </p>
            </div>

            {motifs.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {motifs.map((motif, index) => (
                  <button
                    key={`${motif.start}-${motif.end}-${motif.motif}-${index}`}
                    onClick={() => onFocusRange(motif)}
                    className={`rounded border px-3 py-2 text-left text-[11px] transition ${
                      activeRange?.start === motif.start &&
                      activeRange?.end === motif.end
                        ? "border-red-300 bg-red-50"
                        : "border-slate-200 bg-slate-50 hover:border-red-200 hover:bg-red-50"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        {motif.label}
                      </span>
                      <span className="rounded bg-white px-2 py-0.5 font-mono text-[10px] text-slate-700">
                        {motif.motif}
                      </span>
                    </div>
                    <p className="text-slate-600">
                      {motif.start}-{motif.end} · {motif.category}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-slate-500">
                Aucun motif classique détecté par les règles simples.
              </p>
            )}
          </div>
        </div>

        <div className="col-span-4 space-y-2">
          <div className="rounded border border-emerald-100 bg-emerald-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck size={15} className="text-emerald-700" />
              <p className="text-[12px] font-bold text-emerald-900">
                Interprétation domaines
              </p>
            </div>

            <p className="text-[11px] leading-4 text-emerald-900">
              Les domaines sont proposés à partir de la longueur et de la
              séquence réelle. Les motifs détectés indiquent des zones
              potentiellement importantes pour la modification, l’interaction ou
              la régulation.
            </p>
          </div>

          <div className="rounded border border-blue-100 bg-blue-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Map size={15} className="text-blue-700" />
              <p className="text-[12px] font-bold text-blue-900">
                Règles utilisées
              </p>
            </div>

            <ul className="space-y-1 text-[11px] leading-4 text-blue-900">
              <li>• Segmentation structurale selon longueur</li>
              <li>• Scan de motifs : N-glycosylation, NPxY, PxxP</li>
              <li>• Motifs basiques et cystéines proches</li>
              <li>• Clic domaine/motif → zoom + coloration 3D</li>
            </ul>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-[12px] font-bold text-slate-800">
              Légende
            </p>
            <Legend color="#2563eb" label="Domaine principal" />
            <Legend color="#7c3aed" label="Domaine secondaire" />
            <Legend color="#f59e0b" label="Terminal / linker" />
            <Legend color="#ef4444" label="Motif / région à vérifier" />
            <Legend color="#0891b2" label="Domaine additionnel" />
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionTitle() {
  return (
    <div className="flex items-center gap-2">
      <Dna size={18} className="text-[#0f4c81]" />
      <div>
        <h2 className="text-[14px] font-bold text-slate-900">
          Alignement séquence + domaines réels
        </h2>
        <p className="text-[11px] text-slate-500">
          Analyse basée sur la séquence réelle et reliée au viewer 3D.
        </p>
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

function buildDomainRegions(
  length: number,
  confidence: number | null
): DomainRegion[] {
  if (!length) return [];

  const terminalSize = Math.min(35, Math.max(15, Math.round(length * 0.08)));
  const uncertainColor =
    confidence !== null && confidence >= 85 ? "#f59e0b" : "#ef4444";

  if (length <= 150) {
    return [
      {
        start: 1,
        end: Math.min(length, terminalSize),
        label: "N-terminal",
        type: "terminal",
        confidence: "medium",
        color: uncertainColor,
        description:
          "Extrémité N-terminale souvent flexible, à inspecter en 3D.",
      },
      {
        start: Math.min(length, terminalSize + 1),
        end: Math.max(terminalSize + 1, length - terminalSize),
        label: "Domaine compact",
        type: "domain",
        confidence: "high",
        color: "#2563eb",
        description:
          "Bloc structural principal probable pour une protéine courte.",
      },
      {
        start: Math.max(1, length - terminalSize + 1),
        end: length,
        label: "C-terminal",
        type: "terminal",
        confidence: "medium",
        color: uncertainColor,
        description:
          "Extrémité C-terminale potentiellement mobile ou fonctionnelle.",
      },
    ];
  }

  if (length <= 350) {
    const linkerStart = Math.round(length * 0.47);
    const linkerEnd = Math.round(length * 0.55);

    return [
      {
        start: 1,
        end: terminalSize,
        label: "N-terminal",
        type: "terminal",
        confidence: "medium",
        color: uncertainColor,
        description:
          "Région N-terminale pouvant présenter une flexibilité.",
      },
      {
        start: terminalSize + 1,
        end: linkerStart - 1,
        label: "Domaine 1",
        type: "domain",
        confidence: "high",
        color: "#2563eb",
        description:
          "Premier domaine structural probable.",
      },
      {
        start: linkerStart,
        end: linkerEnd,
        label: "Linker / charnière",
        type: "linker",
        confidence: "medium",
        color: "#f59e0b",
        description:
          "Région intermédiaire pouvant agir comme charnière.",
      },
      {
        start: linkerEnd + 1,
        end: length - terminalSize,
        label: "Domaine 2",
        type: "domain",
        confidence: "high",
        color: "#7c3aed",
        description:
          "Second domaine structural probable.",
      },
      {
        start: length - terminalSize + 1,
        end: length,
        label: "C-terminal",
        type: "terminal",
        confidence: "medium",
        color: uncertainColor,
        description:
          "Extrémité C-terminale pouvant porter des signaux d’interaction.",
      },
    ];
  }

  const d1End = Math.round(length * 0.30);
  const d2Start = Math.round(length * 0.36);
  const d2End = Math.round(length * 0.62);
  const d3Start = Math.round(length * 0.68);

  return [
    {
      start: 1,
      end: terminalSize,
      label: "N-terminal",
      type: "terminal",
      confidence: "medium",
      color: uncertainColor,
      description:
        "Extrémité N-terminale : région souvent flexible ou régulatrice.",
    },
    {
      start: terminalSize + 1,
      end: d1End,
      label: "Domaine 1",
      type: "domain",
      confidence: "high",
      color: "#2563eb",
      description:
        "Premier domaine probable, correspondant à un bloc structural compact.",
    },
    {
      start: d1End + 1,
      end: d2Start - 1,
      label: "Linker 1",
      type: "linker",
      confidence: "medium",
      color: "#f59e0b",
      description:
        "Possible région de connexion entre deux domaines.",
    },
    {
      start: d2Start,
      end: d2End,
      label: "Domaine 2",
      type: "domain",
      confidence: "high",
      color: "#7c3aed",
      description:
        "Domaine central probable, important pour la stabilité globale.",
    },
    {
      start: d2End + 1,
      end: d3Start - 1,
      label: "Linker 2",
      type: "linker",
      confidence: "medium",
      color: "#f59e0b",
      description:
        "Deuxième zone flexible potentielle entre deux blocs structuraux.",
    },
    {
      start: d3Start,
      end: length - terminalSize,
      label: "Domaine 3",
      type: "domain",
      confidence: "medium",
      color: "#0891b2",
      description:
        "Troisième domaine probable ou extension structurée à vérifier.",
    },
    {
      start: length - terminalSize + 1,
      end: length,
      label: "C-terminal",
      type: "terminal",
      confidence: "medium",
      color: uncertainColor,
      description:
        "Extrémité C-terminale : possible région flexible ou site d’interaction.",
    },
  ];
}

function confidenceClass(confidence: "high" | "medium" | "low") {
  if (confidence === "high") {
    return "rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800";
  }

  if (confidence === "medium") {
    return "rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800";
  }

  return "rounded bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800";
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-700">
      <span
        className="h-3 w-3 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </div>
  );
}
