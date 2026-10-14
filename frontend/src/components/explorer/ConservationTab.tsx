"use client";

import { useMemo } from "react";

import ConservationProfile from "@/components/evolution/ConservationProfile";
import MsaViewer from "@/components/evolution/MsaViewer";
import { CONSURF_COLORS } from "@/lib/conservation";
import { layoutTree } from "@/lib/phylo";
import type { ExplorerResult, QualityParams } from "@/lib/explorer";
import AlignmentQuality from "./AlignmentQuality";

const fmt = (v?: number | null) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REGION_COLORS: Record<string, string> = {
  tm: "#d97706",
  intramembrane: "#9a3412",
  loop_out: "#e11d48",
  loop_in: "#2563eb",
  loop: "#94a3b8",
};

/** Étape 2 : alignement multiple et conservation (positions conservées et variables). */
export default function ConservationTab({
  result,
  selected,
  onSelect,
  quality,
  onApplyQuality,
  fileBase,
}: {
  result: ExplorerResult;
  selected: number | null;
  onSelect: (position: number) => void;
  /** Réglages du contrôle qualité de l'analyse affichée. */
  quality?: QualityParams | null;
  onApplyQuality?: (params: QualityParams | null) => Promise<void>;
  fileBase: string;
}) {
  const s = result.summary;
  // Ordre des feuilles de l'arbre, proposé pour l'alignement
  const treeOrder = useMemo(() => {
    const tree = result.tree;
    if (!tree) return undefined;
    return layoutTree(tree.root, "cladogram").order.map((i) => tree.leaves[i]?.id).filter((id): id is string => !!id);
  }, [result]);
  const regions = s.regions.filter((r) => r.mean_score != null);
  const maxRegion = Math.max(...regions.map((r) => r.mean_score ?? 0), 0.01);
  const gradeCounts = Array.from({ length: 9 }, (_, k) => result.positions.filter((p) => p.grade === k + 1).length);

  return (
    <div className="space-y-4">
      <AlignmentQuality result={result} applied={quality} selected={selected} onSelect={onSelect} onApply={onApplyQuality} fileBase={fileBase} />

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[16px] font-semibold text-slate-900">Conservation résidu par résidu</h3>
          <p className="text-[13px] text-slate-500">
            Moyenne : membrane <b className="text-slate-800">{fmt(s.tm_mean_score)}</b> · hors membrane{" "}
            <b className="text-slate-800">{fmt(s.loop_mean_score)}</b>
          </p>
        </div>
        <ConservationProfile
          positions={result.positions}
          tmSegments={s.tm_segments}
          selected={selected}
          onSelect={(p) => onSelect(p.position)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
          <span>Variable</span>
          {CONSURF_COLORS.map((color, k) => (
            <span key={color} className="flex items-center gap-0.5" title={`${gradeCounts[k]} position(s)`}>
              <span className="inline-block h-3 w-5 rounded-sm ring-1 ring-slate-300" style={{ backgroundColor: color }} />
              {k + 1}
            </span>
          ))}
          <span>Conservé</span>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-[16px] font-semibold text-slate-900">Positions conservées et variables</h3>
          <p className="mb-2 text-[13px] text-slate-500">Cliquez une position pour la suivre dans tous les onglets.</p>
          <p className="mb-1 text-[13px] font-semibold text-[#a02560]">Les plus conservées</p>
          <div className="flex flex-wrap gap-1.5">
            {s.most_conserved.map((p) => (
              <Chip key={p.position} label={`${p.residue}${p.position}`} color="#a02560" active={selected === p.position} onClick={() => onSelect(p.position)} />
            ))}
          </div>
          <p className="mb-1 mt-3 text-[13px] font-semibold text-cyan-700">Les plus variables</p>
          <div className="flex flex-wrap gap-1.5">
            {result.most_variable.map((p) => (
              <Chip key={p.position} label={`${p.residue}${p.position}`} color="#0e9aa7" active={selected === p.position} onClick={() => onSelect(p.position)} />
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-5 text-slate-500">
            Score : divergence de Jensen-Shannon (Capra &amp; Singh, 2007), séquences pondérées (Henikoff), pénalisé par
            les gaps. Grades 1 à 9 relatifs à la protéine, comme ConSurf. Les positions à plus de 30 % de gaps ne
            figurent pas parmi les variables ; les colonnes masquées par le contrôle qualité (hachurées) ne sont ni
            classées ni proposées.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-[16px] font-semibold text-slate-900">Conservation par région</h3>
          <p className="mb-2 text-[13px] text-slate-500">Hélices transmembranaires, boucles et extrémités.</p>
          {regions.length === 0 ? (
            <p className="text-[14px] text-slate-500">Aucune région membranaire connue pour la référence.</p>
          ) : (
            <ul className="max-h-[340px] space-y-1 overflow-auto pr-1">
              {regions.map((r) => (
                <li key={`${r.start}-${r.label}`}>
                  <button
                    onClick={() => onSelect(Math.round((r.start + r.end) / 2))}
                    className="grid w-full grid-cols-[150px_1fr_44px] items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] hover:bg-slate-50"
                  >
                    <span className="truncate text-slate-700" title={`${r.label} (${r.start}–${r.end})`}>
                      {r.label} <span className="text-slate-400">{r.start}–{r.end}</span>
                    </span>
                    <span className="h-3 rounded-sm bg-slate-100">
                      <span
                        className="block h-3 rounded-sm"
                        style={{ width: `${((r.mean_score ?? 0) / maxRegion) * 100}%`, backgroundColor: REGION_COLORS[r.kind] ?? "#94a3b8" }}
                      />
                    </span>
                    <span className="text-right tabular-nums text-slate-600">{fmt(r.mean_score)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Alignement multiple</h3>
        <p className="mb-3 text-[13px] text-slate-500">
          Ancré sur la référence : les résidus identiques à la référence prennent la couleur de conservation de la colonne.
        </p>
        <MsaViewer
          query={result.query_sequence}
          rows={result.msa}
          positions={result.positions}
          regions={s.regions}
          selected={selected}
          onSelect={onSelect}
          treeOrder={treeOrder}
        />
      </section>
    </div>
  );
}

export function Chip({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 font-mono text-[13px] font-semibold text-white ${active ? "ring-2 ring-offset-1 ring-slate-900" : "hover:opacity-85"}`}
      style={{ backgroundColor: color }}
    >
      {label}
    </button>
  );
}
