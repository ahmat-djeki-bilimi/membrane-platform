"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ExternalLink } from "lucide-react";
import TopologyDiagram from "@/components/protein/TopologyDiagram";
import { InfoBox } from "@/components/ui";
import { gradeColor } from "@/lib/conservation";
import { TOPOLOGY_SOURCES, ZONES, type ExplorerResult } from "@/lib/explorer";
import type { Region } from "@/lib/topology";

const Membrane3DViewer = dynamic(() => import("@/components/Membrane3DViewer"), { ssr: false });

const SIDE = { in: "cytoplasmique", out: "externe" } as const;
const CROSSING = { full: "traverse", short: "traverse (hélice courte)", partial: "ne traverse pas" } as const;

/** Étape 3 : topologie (DeepTMHMM, UniProt) et orientation dans la membrane (modèle 3D, OPM). */
export default function TopologyTab({
  result,
  selected,
  onSelect,
}: {
  result: ExplorerResult;
  selected: number | null;
  onSelect: (position: number) => void;
}) {
  const [colorByGrade, setColorByGrade] = useState(false);
  const { topology, structure, opm } = result;

  // Segments TM et côtés des boucles pour le schéma
  const regions: Region[] = useMemo(() => {
    const list: Region[] = topology.segments.map((s) => ({ start: s.start, end: s.end, type: "transmembrane", label: s.label }));
    for (const r of result.summary.regions) {
      if (r.side === "in" || r.side === "out")
        list.push({ start: r.start, end: r.end, type: "topological", label: r.side === "in" ? "Cytoplasmic" : "Extracellular" });
    }
    return list;
  }, [topology, result.summary.regions]);

  const membrane = structure?.membrane ?? null;
  const half = membrane ? membrane.thickness / 2 : null;
  const sidesSource =
    topology.source === "deeptmhmm" ? "DeepTMHMM" : topology.source === "uniprot" ? "les domaines topologiques UniProt" : "la règle « positive-inside »";

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Topologie de la référence</h3>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <InfoBox label="Source des segments" value={TOPOLOGY_SOURCES[topology.source]} />
          <InfoBox label="Segments transmembranaires" value={`${topology.segments.length}`} />
          <InfoBox
            label="Extrémité N-terminale"
            value={topology.n_terminus ? `côté ${SIDE[topology.n_terminus]}` : membrane ? `côté ${SIDE[membrane.n_terminus]} (modèle)` : "inconnue"}
          />
          <InfoBox
            label="DeepTMHMM"
            value={
              topology.source === "deeptmhmm"
                ? topology.predicted_type ?? "utilisé"
                : topology.deeptmhmm_status === "queued" || topology.deeptmhmm_status === "running"
                  ? "en cours (relancez plus tard)"
                  : topology.deeptmhmm_status === "failed"
                    ? "en échec"
                    : "non disponible sur ce serveur"
            }
          />
        </dl>
        {topology.segments.length > 0 ? (
          <div className="mt-3">
            <label className="mb-1 flex items-center gap-1.5 text-[13px] text-slate-700">
              <input type="checkbox" checked={colorByGrade} onChange={(e) => setColorByGrade(e.target.checked)} />
              Colorer les résidus par conservation
            </label>
            <TopologyDiagram
              regions={regions}
              length={result.length}
              sidesSource={sidesSource}
              residueColor={colorByGrade ? (position) => gradeColor(result.positions[position - 1]?.grade ?? 1) : undefined}
              activeRange={selected ? { start: selected, end: selected, color: "#7c3aed" } : null}
              onSelect={(range) => onSelect(Math.round((range.start + range.end) / 2))}
            />
          </div>
        ) : (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
            Aucun segment transmembranaire détecté pour la référence : la protéine n’est peut-être pas membranaire, ou
            ses segments échappent à l’estimation par hydropathie.
          </p>
        )}
      </section>

      {structure ? (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">
              Orientation dans la membrane — modèle {structure.source}
            </h3>
            <p className="mb-2 text-[13px] text-slate-500">
              {structure.method}
              {structure.window && !structure.window.complete
                ? ` · résidus ${structure.window.start}–${structure.window.end} modélisés (fenêtre de ${structure.window.max_length})`
                : ""}
              {structure.mean_plddt != null ? ` · pLDDT moyen ${Math.round(structure.mean_plddt)}` : ""}
            </p>
            <Membrane3DViewer
              coordinates={structure.pdb}
              downloadName={`${result.reference.accession ?? "reference"}_${structure.source}_membrane.pdb`}
              subunits={[{ chain: "A", segments: topology.segments }]}
              tmLegend="Segments TM"
              outsideLabel="Côté externe"
              insideLabel="Côté cytoplasmique"
              activeRange={selected ? { start: selected, end: selected, color: "#7c3aed" } : null}
            />
          </section>

          <div className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-[16px] font-semibold text-slate-900">Bicouche ajustée et validation OPM</h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <InfoBox label="Épaisseur hydrophobe (modèle)" value={membrane ? `${membrane.thickness} Å` : "non placée"} />
                <InfoBox
                  label="Épaisseur hydrophobe (OPM)"
                  value={opm?.hydrophobic_thickness ? `${opm.hydrophobic_thickness} Å (${opm.pdb_id})` : opm?.structure_count ? "aucune structure dans OPM" : "pas de structure PDB"}
                />
                <InfoBox
                  label="Côté cytoplasmique déterminé par"
                  value={membrane ? (membrane.side_method === "topology" ? "la topologie" : `les charges (K/R : ${membrane.kr_inside} dedans, ${membrane.kr_outside} dehors)`) : "—"}
                />
                <InfoBox label="Inclinaison (OPM)" value={opm?.tilt_angle != null ? `${opm.tilt_angle}°` : "—"} />
              </dl>
              {opm?.pdb_id && (
                <p className="mt-2 text-[13px] text-slate-600">
                  OPM : {opm.type} · {opm.superfamily} › {opm.family} · {opm.membrane}.{" "}
                  {opm.n_terminus && membrane && (
                    <span className={opm.n_terminus === membrane.n_terminus ? "text-emerald-700" : "text-rose-700"}>
                      N-terminal {SIDE[opm.n_terminus]} selon OPM
                      {opm.n_terminus === membrane.n_terminus ? " : accord avec le modèle." : " : désaccord avec le modèle, à vérifier."}
                    </span>
                  )}{" "}
                  {opm.url && (
                    <a href={opm.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-blue-700 hover:underline">
                      Fiche OPM <ExternalLink size={11} />
                    </a>
                  )}
                </p>
              )}
            </section>

            {structure.helices.length > 0 && (
              <section className="rounded-lg border border-slate-200 bg-white">
                <h3 className="border-b border-slate-100 px-4 py-2.5 text-[16px] font-semibold text-slate-900">Hélices dans le modèle</h3>
                <div className="max-h-[300px] overflow-auto">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 font-semibold">Hélice</th>
                        <th className="px-3 py-1.5 font-semibold">Résidus</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Inclinaison</th>
                        <th className="px-3 py-1.5 font-semibold">Membrane</th>
                        <th className="px-3 py-1.5 text-right font-semibold">pLDDT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {structure.helices.map((h) => (
                        <tr key={h.label} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onSelect(Math.round((h.start + h.end) / 2))}>
                          <td className="px-3 py-1.5 font-semibold">{h.label}</td>
                          <td className="px-3 py-1.5 tabular-nums">{h.start}–{h.end}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{h.tilt}°</td>
                          <td className={`px-3 py-1.5 ${h.crossing === "partial" ? "text-amber-700" : "text-slate-700"}`}>{CROSSING[h.crossing]}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{h.mean_plddt != null ? Math.round(h.mean_plddt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-[14px] text-slate-600">
          Aucune structure 3D n’a pu être obtenue pour la référence (ni AlphaFold DB, ni ESMFold) : l’orientation dans la
          membrane n’est pas disponible. Les zones des résidus sont alors déduites de la topologie seule.
        </p>
      )}

      {half != null && <DepthProfile result={result} half={half} selected={selected} onSelect={onSelect} />}
    </div>
  );
}

/** Profondeur de chaque résidu dans la membrane (axe z du modèle), le long de la séquence. */
function DepthProfile({
  result,
  half,
  selected,
  onSelect,
}: {
  result: ExplorerResult;
  half: number;
  selected: number | null;
  onSelect: (position: number) => void;
}) {
  const W = 1000;
  const H = 220;
  const L = 34;
  const points = result.positions.filter((p) => p.z != null);
  const zMax = Math.max(half + 15, ...points.map((p) => Math.abs(p.z!)));
  const x = (pos: number) => L + ((pos - 1) / Math.max(result.length - 1, 1)) * (W - L - 8);
  const y = (z: number) => H / 2 - (z / zMax) * (H / 2 - 10);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-[16px] font-semibold text-slate-900">Profondeur des résidus dans la membrane</h3>
      <p className="mb-2 text-[13px] text-slate-500">
        Position de chaque Cα le long de la normale (0 = centre de la bicouche ; haut = côté externe). Couleur : zone.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Profondeur des résidus">
        <rect x={L} y={y(half)} width={W - L - 8} height={y(-half) - y(half)} fill="#fef3c7" />
        <line x1={L} x2={W - 8} y1={y(half)} y2={y(half)} stroke="#e11d48" strokeDasharray="4 3" />
        <line x1={L} x2={W - 8} y1={y(-half)} y2={y(-half)} stroke="#2563eb" strokeDasharray="4 3" />
        <line x1={L} x2={W - 8} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
        {[-20, 0, 20].map((z) => (
          <text key={z} x={L - 4} y={y(z) + 4} textAnchor="end" fontSize="11" fill="#64748b">
            {z}
          </text>
        ))}
        {points.map((p) => (
          <circle
            key={p.position}
            cx={x(p.position)}
            cy={y(p.z!)}
            r={selected === p.position ? 5 : 2.2}
            fill={selected === p.position ? "#7c3aed" : ZONES[p.zone]?.color ?? "#94a3b8"}
            className="cursor-pointer"
            onClick={() => onSelect(p.position)}
          >
            <title>{`${p.residue}${p.position} · z = ${p.z} Å · ${ZONES[p.zone]?.label ?? ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-slate-600">
        {(["core", "interface_out", "interface_in", "out", "in"] as const).map((z) => (
          <span key={z} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ZONES[z].color }} />
            {ZONES[z].label}
          </span>
        ))}
      </div>
    </section>
  );
}
