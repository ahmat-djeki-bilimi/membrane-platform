"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { gradeColor, type ConservedPosition } from "@/lib/conservation";

// Largeurs fixes : le nombre de positions affichées dépend de la place disponible
const CELL_PX = 15;
const NAME_PX = 200;
const PADDING_PX = 32;
const MIN_WINDOW = 20;

export type MsaRegion = { kind: string; label: string; start: number; end: number; mean_score?: number | null };

// Couleurs des régions (identiques au schéma de topologie)
const REGION_STYLE: Record<string, { background: string; text: string; name: string }> = {
  tm: { background: "#d97706", text: "#ffffff", name: "Hélice TM" },
  intramembrane: { background: "#9a3412", text: "#ffffff", name: "Intramembranaire" },
  loop_out: { background: "#fecdd3", text: "#9f1239", name: "Boucle extérieure" },
  loop_in: { background: "#bfdbfe", text: "#1e40af", name: "Boucle cytoplasmique" },
  loop: { background: "#e2e8f0", text: "#334155", name: "Boucle" },
};
const MEMBRANE_KINDS = new Set(["tm", "intramembrane"]);

/**
 * Alignement multiple ancré sur la protéine étudiée, affiché par fenêtres
 * adaptées à la largeur de l'écran. Les résidus identiques à ceux de la protéine étudiée prennent
 * la couleur de conservation de la colonne ; les substitutions sont en gris.
 */
export default function MsaViewer({
  query,
  rows,
  positions,
  selected,
  onSelect,
  regions = [],
}: {
  query: string;
  rows: { accession: string; organism: string; row: string }[];
  positions: ConservedPosition[];
  selected?: number | null;
  onSelect?: (position: number) => void;
  /** Régions membranaires (hélices TM, boucles…) de la protéine étudiée. */
  regions?: MsaRegion[];
}) {
  const [start, setStart] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [highlightTM, setHighlightTM] = useState(true);
  const [windowSize, setWindowSize] = useState(60);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const length = query.length;
  const WINDOW = Math.min(windowSize, length);
  const end = Math.min(start + WINDOW - 1, length);

  // Autant de positions que la largeur le permet, recalculé au redimensionnement
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const columns = Math.floor((element.clientWidth - NAME_PX - PADDING_PX) / CELL_PX);
      setWindowSize(Math.max(MIN_WINDOW, columns));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Garder la fenêtre dans la séquence quand elle s'élargit
  useEffect(() => {
    if (start > Math.max(1, length - WINDOW + 1)) setStart(Math.max(1, length - WINDOW + 1));
  }, [WINDOW, length, start]);
  const visibleRows = showAll ? rows : rows.slice(0, 30);

  // Suivre le résidu sélectionné ailleurs (profil, 3D)
  useEffect(() => {
    if (selected && (selected < start || selected > end)) {
      setStart(Math.max(1, Math.min(selected - Math.floor(WINDOW / 2), length - WINDOW + 1)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const columns = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const regionAt = (position: number) => regions.find((r) => r.start <= position && position <= r.end);
  const inMembrane = (position: number) => MEMBRANE_KINDS.has(regionAt(position)?.kind ?? "");
  const go = (to: number) => setStart(Math.max(1, Math.min(to, Math.max(1, length - WINDOW + 1))));

  const cell = (residue: string, position: number, isQuery: boolean) => {
    const q = query[position - 1];
    const grade = positions[position - 1]?.grade ?? 1;
    const isSelected = selected === position;
    let style: React.CSSProperties =
      highlightTM && inMembrane(position) ? { backgroundColor: "#fef3c7" } : {};
    let className = "text-slate-400";
    if (residue === "-") className = "text-slate-300";
    else if (isQuery || residue === q) {
      style = { backgroundColor: gradeColor(grade) };
      className = grade >= 8 ? "text-white font-semibold" : "text-slate-900";
    }
    return (
      <span
        key={position}
        onClick={() => onSelect?.(position)}
        className={`inline-block w-[15px] cursor-pointer text-center ${className} ${isSelected ? "outline outline-2 outline-violet-600" : ""}`}
        style={style}
      >
        {residue}
      </span>
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[14px]">
        <button onClick={() => go(start - WINDOW)} disabled={start <= 1} className="rounded-md border border-slate-200 p-1 hover:bg-slate-50 disabled:opacity-40" aria-label="Positions précédentes">
          <ChevronLeft size={16} />
        </button>
        <span className="font-mono text-slate-700">
          Positions {start}–{end} / {length}
        </span>
        <button onClick={() => go(start + WINDOW)} disabled={end >= length} className="rounded-md border border-slate-200 p-1 hover:bg-slate-50 disabled:opacity-40" aria-label="Positions suivantes">
          <ChevronRight size={16} />
        </button>
        <input
          type="range"
          min={1}
          max={Math.max(1, length - WINDOW + 1)}
          value={start}
          onChange={(e) => setStart(Number(e.target.value))}
          className="min-w-[160px] flex-1 accent-[#0f4c81]"
          aria-label="Déplacer la fenêtre"
        />
        {regions.some((r) => MEMBRANE_KINDS.has(r.kind)) && (
          <label className="flex items-center gap-1.5 text-slate-700">
            <input type="checkbox" checked={highlightTM} onChange={(e) => setHighlightTM(e.target.checked)} className="accent-amber-600" />
            Surligner les segments TM
          </label>
        )}
      </div>

      <div ref={containerRef} className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full font-mono text-[13px] leading-5">
          <tbody>
            <tr className="bg-slate-50 text-[11px] text-slate-400">
              <td className="sticky left-0 w-[200px] min-w-[200px] bg-slate-50 px-2" />
              <td className="whitespace-nowrap px-2">
                {columns.map((p) => (
                  <span key={p} className="inline-block w-[15px] text-center">
                    {p % 10 === 0 ? "|" : ""}
                  </span>
                ))}
              </td>
            </tr>
            {regions.length > 0 && (
              <tr>
                <td className="sticky left-0 w-[200px] min-w-[200px] bg-white px-2 font-sans text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                  Topologie
                </td>
                <td className="whitespace-nowrap px-2">
                  {columns.map((p) => {
                    const region = regionAt(p);
                    const style = REGION_STYLE[region?.kind ?? ""] ?? { background: "transparent", text: "#334155", name: "" };
                    // Nom de la région sur sa première colonne visible
                    const showLabel = region && (p === region.start || p === start);
                    return (
                      <span
                        key={p}
                        className="relative inline-block h-5 w-[15px] align-middle"
                        style={{ backgroundColor: style.background }}
                        title={region ? `${region.label} (${region.start}–${region.end})` : undefined}
                      >
                        {showLabel && (
                          <span
                            className="pointer-events-none absolute left-0.5 top-0 z-10 whitespace-nowrap font-sans text-[11px] font-bold leading-5"
                            style={{ color: style.text }}
                          >
                            {region!.label.replace("Boucle extérieure", "Ext.").replace("Boucle cytoplasmique", "Cyt.").replace("Extrémité ", "")}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </td>
              </tr>
            )}
            <tr>
              <td className="sticky left-0 w-[200px] min-w-[200px] bg-white px-2 font-sans text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                Conservation
              </td>
              <td className="whitespace-nowrap px-2">
                {columns.map((p) => {
                  const grade = positions[p - 1]?.grade ?? 1;
                  return (
                    <span
                      key={p}
                      onClick={() => onSelect?.(p)}
                      className="inline-block w-[15px] cursor-pointer text-center font-sans text-[11px] font-semibold"
                      style={{ backgroundColor: gradeColor(grade), color: grade >= 8 ? "#ffffff" : "#0f172a" }}
                      title={`Position ${p} · grade ${grade}/9`}
                    >
                      {grade}
                    </span>
                  );
                })}
              </td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="sticky left-0 w-[200px] min-w-[200px] max-w-[200px] truncate bg-white px-2 font-sans text-[13px] font-semibold text-[#0f4c81]">
                Protéine étudiée
              </td>
              <td className="whitespace-nowrap px-2">{columns.map((p) => cell(query[p - 1], p, true))}</td>
            </tr>
            {visibleRows.map((r) => (
              <tr key={r.accession} className="hover:bg-slate-50">
                <td className="sticky left-0 w-[200px] min-w-[200px] max-w-[200px] truncate bg-white px-2 font-sans text-[13px] italic text-slate-600" title={`${r.organism} · ${r.accession}`}>
                  {r.organism.replace(/\s*\(.*\)$/, "")}
                </td>
                <td className="whitespace-nowrap px-2">{columns.map((p) => cell(r.row[p - 1], p, false))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate-500">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Résidu identique à la protéine étudiée : couleur du grade de la colonne ; gris : substitution.</span>
          {regions.length > 0 &&
            Object.entries(REGION_STYLE)
              .filter(([kind]) => regions.some((r) => r.kind === kind))
              .map(([kind, style]) => (
                <span key={kind} className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: style.background }} />
                  {style.name}
                </span>
              ))}
          {highlightTM && regions.some((r) => MEMBRANE_KINDS.has(r.kind)) && (
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" />
              Colonnes membranaires
            </span>
          )}
        </span>
        {rows.length > 30 && (
          <button onClick={() => setShowAll((v) => !v)} className="font-medium text-[#0f4c81] hover:underline">
            {showAll ? "Afficher 30 séquences" : `Afficher les ${rows.length} séquences`}
          </button>
        )}
      </div>
    </div>
  );
}
