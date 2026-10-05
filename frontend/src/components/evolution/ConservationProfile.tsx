"use client";

import { useRef, useState } from "react";
import { gradeColor, type ConservedPosition } from "@/lib/conservation";

const W = 1000;
const H = 200;
const LEFT = 30;
const RIGHT = 8;
const TOP = 8;
const PLOT_H = 140;
const TM_Y = TOP + PLOT_H + 8;

/**
 * Conservation résidu par résidu : hauteur = score de Jensen-Shannon,
 * couleur = grade ConSurf (1 variable → 9 conservé).
 */
export default function ConservationProfile({
  positions,
  tmSegments,
  selected,
  onSelect,
}: {
  positions: ConservedPosition[];
  tmSegments: { start: number; end: number; label?: string }[];
  selected?: number | null;
  onSelect?: (position: ConservedPosition) => void;
}) {
  const [hover, setHover] = useState<ConservedPosition | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const n = positions.length;
  const plotW = W - LEFT - RIGHT;
  const barW = plotW / Math.max(n, 1);
  const max = Math.max(...positions.map((p) => p.score), 0.01);
  const x = (pos: number) => LEFT + (pos - 1) * barW;

  const pick = (clientX: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const index = Math.floor((px - LEFT) / barW);
    return index >= 0 && index < n ? positions[index] : null;
  };

  const shown = hover ?? (selected ? positions[selected - 1] : null);

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full cursor-crosshair"
        role="img"
        aria-label="Profil de conservation par résidu"
        onMouseMove={(e) => setHover(pick(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const p = pick(e.clientX);
          if (p) onSelect?.(p);
        }}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={LEFT} x2={W - RIGHT} y1={TOP + PLOT_H * (1 - f)} y2={TOP + PLOT_H * (1 - f)} stroke="#eef2f6" />
        ))}
        <line x1={LEFT} x2={W - RIGHT} y1={TOP + PLOT_H} y2={TOP + PLOT_H} stroke="#94a3b8" />
        <text x={LEFT - 5} y={TOP + 10} fontSize={12} fill="#64748b" textAnchor="end">
          max
        </text>
        <text x={LEFT - 5} y={TOP + PLOT_H} fontSize={12} fill="#64748b" textAnchor="end">
          0
        </text>

        {positions.map((p) => {
          const h = Math.max((p.score / max) * PLOT_H, 1);
          return (
            <rect
              key={p.position}
              x={x(p.position)}
              y={TOP + PLOT_H - h}
              width={Math.max(barW - (barW > 3 ? 0.5 : 0), 0.6)}
              height={h}
              fill={gradeColor(p.grade)}
              stroke={p.grade === 5 ? "#cbd5e1" : "none"}
              strokeWidth={0.4}
            />
          );
        })}

        {shown && (
          <line x1={x(shown.position) + barW / 2} x2={x(shown.position) + barW / 2} y1={TOP} y2={TM_Y + 10} stroke="#0f172a" />
        )}

        <rect x={LEFT} y={TM_Y} width={plotW} height={10} rx={2} fill="#f1f5f9" />
        {tmSegments.map((s, i) => (
          <rect key={i} x={x(s.start)} y={TM_Y} width={Math.max((s.end - s.start + 1) * barW, 2)} height={10} rx={2} fill="#d97706">
            <title>{`${s.label || `TM${i + 1}`} : ${s.start}–${s.end}`}</title>
          </rect>
        ))}
        <text x={LEFT - 5} y={TM_Y + 9} fontSize={11} fill="#b45309" textAnchor="end">
          TM
        </text>
        <text x={LEFT} y={H - 4} fontSize={12} fill="#64748b">
          1
        </text>
        <text x={W - RIGHT} y={H - 4} fontSize={12} fill="#64748b" textAnchor="end">
          {n}
        </text>
      </svg>

      <div className="mt-1 min-h-[22px] text-[14px] text-slate-600" aria-live="polite">
        {shown ? (
          <>
            <span className="font-mono font-semibold text-slate-900">
              {shown.residue}
              {shown.position}
            </span>{" "}
            · grade{" "}
            <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
              <span className="inline-block h-3 w-3 rounded-sm ring-1 ring-slate-300" style={{ backgroundColor: gradeColor(shown.grade) }} />
              {shown.grade}/9
            </span>{" "}
            · {Math.round(shown.query_residue_frequency * 100)} % des homologues ont {shown.residue}
            {shown.top_residues.length > 1 && (
              <> · résidus observés : {shown.top_residues.map((r) => `${r.residue} ${Math.round(r.frequency * 100)} %`).join(", ")}</>
            )}
            {shown.gap_fraction > 0.2 && <> · {Math.round(shown.gap_fraction * 100)} % de gaps</>}
          </>
        ) : (
          "Survolez le profil pour lire la conservation d’un résidu ; cliquez pour le voir en 3D."
        )}
      </div>
    </div>
  );
}
