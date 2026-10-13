"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Download } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import { CONSURF_COLORS, gradeColor } from "@/lib/conservation";
import { CATEGORY_COLORS, ZONES, pdbWithGrades, residuesCsv, type Candidate, type ExplorerResult, type Zone } from "@/lib/explorer";
import { downloadText } from "@/lib/sequence";
import { LegendItem, type ResidueMark } from "./ExplorerViewer";

const ExplorerViewer = dynamic(() => import("./ExplorerViewer"), { ssr: false });

type ColorMode = "conservation" | "zone" | "candidates";
const CATEGORIES = Object.keys(CATEGORY_COLORS) as Candidate["category"][];
const ZONE_ORDER: Zone[] = ["out", "interface_out", "core", "membrane", "interface_in", "in", "loop"];

/** Étape 4 : cartographie structurale (conservation, régions TM, positions candidates). */
export default function CartographyTab({
  result,
  selected,
  onSelect,
  fileBase,
}: {
  result: ExplorerResult;
  selected: number | null;
  onSelect: (position: number) => void;
  fileBase: string;
}) {
  const [mode, setMode] = useState<ColorMode>("conservation");
  const [category, setCategory] = useState<Candidate["category"] | "all">("all");
  const { structure, positions, candidates } = result;

  const shown = useMemo(
    () => (category === "all" ? candidates : candidates.filter((c) => c.category === category)),
    [candidates, category]
  );

  const colors = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of positions) {
      if (mode === "conservation") map.set(p.position, gradeColor(p.grade));
      else if (mode === "zone") map.set(p.position, ZONES[p.zone]?.color ?? "#cbd5e1");
    }
    if (mode === "candidates") for (const c of candidates) map.set(c.position, CATEGORY_COLORS[c.category]);
    return map;
  }, [positions, candidates, mode]);

  const marks: ResidueMark[] = useMemo(() => {
    // Bâtonnets pour 15 positions, étiquettes pour les 8 premières (lisibilité)
    const list: ResidueMark[] = shown.slice(0, 15).map((c, k) => ({
      position: c.position,
      color: CATEGORY_COLORS[c.category],
      label: k < 8 ? `${c.residue}${c.position}` : undefined,
    }));
    if (selected && !list.some((m) => m.position === selected)) {
      const p = positions[selected - 1];
      if (p) list.push({ position: selected, color: "#7c3aed", label: `${p.residue}${selected}` });
    }
    return list;
  }, [shown, selected, positions]);

  // Conservation par zone de la membrane
  const zoneStats = useMemo(
    () =>
      ZONE_ORDER.map((zone) => {
        const items = positions.filter((p) => p.zone === zone);
        return {
          zone,
          count: items.length,
          conserved: items.filter((p) => p.grade >= 8).length,
          mean: items.length ? items.reduce((s, p) => s + p.grade, 0) / items.length : null,
        };
      }).filter((z) => z.count > 0),
    [positions]
  );

  const legend =
    mode === "conservation" ? (
      <>
        <LegendItem color={CONSURF_COLORS[8]} label="Conservé (grade 9)" />
        <LegendItem color={CONSURF_COLORS[4]} label="Moyen (5)" />
        <LegendItem color={CONSURF_COLORS[0]} label="Variable (1)" />
      </>
    ) : mode === "zone" ? (
      <>
        {zoneStats.map((z) => (
          <LegendItem key={z.zone} color={ZONES[z.zone].color} label={ZONES[z.zone].label} />
        ))}
      </>
    ) : (
      <>
        {CATEGORIES.map((c) => (
          <LegendItem key={c} color={CATEGORY_COLORS[c]} label={c} />
        ))}
      </>
    );

  return (
    <div className="space-y-4">
      <div className={`grid gap-4 ${structure ? "xl:grid-cols-[1.25fr_1fr]" : ""}`}>
        {structure && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[16px] font-semibold text-slate-900">Carte 3D des résidus</h3>
              <SegmentedControl
                label="Coloration"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "conservation", label: "Conservation" },
                  { value: "zone", label: "Zones membranaires" },
                  { value: "candidates", label: "Candidates" },
                ]}
              />
            </div>
            <ExplorerViewer pdb={structure.pdb} colors={colors} marks={marks} focus={selected} legend={legend} />
            <p className="mt-2 text-[13px] text-slate-500">
              Bâtonnets : les 15 premières positions candidates (étiquettes sur les 8 premières){category !== "all" ? ` (${category.toLowerCase()})` : ""}. {`Modèle ${structure.source} placé dans la membrane ;`} les régions de faible confiance (pLDDT &lt; 50) sont à interpréter avec prudence.
            </p>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-[16px] font-semibold text-slate-900">Conservation selon la position dans la membrane</h3>
          <p className="mb-2 text-[13px] text-slate-500">
            {structure?.membrane
              ? "Zones déduites de la profondeur de chaque résidu dans le modèle (interfaces : ± 5 Å autour des faces)."
              : "Zones déduites de la topologie (aucun modèle placé dans la membrane)."}
          </p>
          <table className="w-full text-[13px]">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 font-semibold">Zone</th>
                <th className="py-1 text-right font-semibold">Résidus</th>
                <th className="py-1 text-right font-semibold">Très conservés</th>
                <th className="py-1 text-right font-semibold">Grade moyen</th>
              </tr>
            </thead>
            <tbody>
              {zoneStats.map((z) => (
                <tr key={z.zone} className="border-t border-slate-100">
                  <td className="py-1.5">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ZONES[z.zone].color }} />
                    {ZONES[z.zone].label}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{z.count}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {z.conserved} ({Math.round((100 * z.conserved) / z.count)} %)
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{z.mean?.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => downloadText(`${fileBase}_cartographie.csv`, residuesCsv(result), "text/csv")}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              <Download size={13} />
              Tableau des résidus (CSV)
            </button>
            {structure && (
              <button
                onClick={() => downloadText(`${fileBase}_conservation.pdb`, pdbWithGrades(structure.pdb, positions))}
                title="Grade de conservation dans la colonne B-factor, pour PyMOL ou ChimeraX"
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                <Download size={13} />
                PDB coloré par conservation
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <div>
            <h3 className="text-[16px] font-semibold text-slate-900">Positions candidates ({candidates.length})</h3>
            <p className="text-[13px] text-slate-500">
              Classées par conservation, position dans la membrane, nature chimique et coévolution. Hypothèses à tester
              par mutagenèse, pas des preuves.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            <FilterButton active={category === "all"} onClick={() => setCategory("all")} label="Toutes" />
            {CATEGORIES.filter((c) => candidates.some((x) => x.category === c)).map((c) => (
              <FilterButton key={c} active={category === c} onClick={() => setCategory(c)} label={c} color={CATEGORY_COLORS[c]} />
            ))}
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {shown.map((c) => (
            <li key={c.position}>
              <button
                onClick={() => onSelect(c.position)}
                className={`grid w-full gap-x-3 px-4 py-2 text-left sm:grid-cols-[90px_170px_1fr] ${selected === c.position ? "bg-violet-50" : "hover:bg-slate-50"}`}
              >
                <span className="flex items-center gap-2">
                  <span className="rounded px-1.5 py-0.5 font-mono text-[13px] font-bold text-white" style={{ backgroundColor: CATEGORY_COLORS[c.category] }}>
                    {c.residue}
                    {c.position}
                  </span>
                </span>
                <span className="text-[13px]">
                  <span className="font-semibold" style={{ color: CATEGORY_COLORS[c.category] }}>
                    {c.category}
                  </span>
                  <span className="block text-slate-500">
                    {ZONES[c.zone]?.label ?? c.zone}
                    {c.region ? ` · ${c.region}` : ""}
                  </span>
                </span>
                <span className="text-[13px] leading-5 text-slate-700">{c.reasons.join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
        {candidates.length === 0 && <p className="p-4 text-[14px] text-slate-500">Aucune position ne réunit assez d’indices.</p>}
      </section>
    </div>
  );
}

function FilterButton({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold ${active ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
    </button>
  );
}
