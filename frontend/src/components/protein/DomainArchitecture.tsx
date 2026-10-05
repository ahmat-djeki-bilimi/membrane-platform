"use client";

import { useMemo, useState } from "react";
import { niceStep, sideOf, type Region } from "@/lib/topology";

type HighlightRange = { start: number; end: number; label?: string; color?: string };

const W = 1000;
const LEFT = 40;
const RIGHT = 30;
const BACKBONE_Y = 120;
const DOMAIN_COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#059669", "#db2777", "#4f46e5", "#0d9488", "#c026d3"];
const SIDE_COLORS = { in: "#2563eb", out: "#e11d48" } as const;

type Tip = { x: number; y: number; title: string; detail: string } | null;

/**
 * Architecture des domaines (style Pfam / InterPro) : règle graduée, squelette
 * coloré selon le compartiment, domaines, segments membranaires, motifs et
 * régions.
 */
export default function DomainArchitecture({
  regions,
  length,
  activeRange,
  onSelect,
}: {
  regions: Region[];
  length: number;
  activeRange?: HighlightRange | null;
  onSelect?: (range: HighlightRange) => void;
}) {
  const [tip, setTip] = useState<Tip>(null);
  const x = (pos: number) => LEFT + ((pos - 1) / Math.max(length - 1, 1)) * (W - LEFT - RIGHT);
  const width = (r: { start: number; end: number }) => Math.max(x(r.end + 1) - x(r.start), 2);

  const domains = regions.filter((r) => r.type === "domain" || r.type === "repeat");
  const membrane = regions.filter((r) => r.type === "transmembrane" || r.type === "intramembrane");
  const signals = regions.filter((r) => r.type === "signal");
  const motifs = regions.filter((r) => r.type === "motif");
  const topological = regions.filter((r) => r.type === "topological");

  // Régions sur des lignes séparées pour éviter les chevauchements
  const lanes = useMemo(() => {
    const items = regions.filter((r) => r.type === "region").sort((a, b) => a.start - b.start);
    const laneEnds: number[] = [];
    return items.map((r) => {
      let lane = laneEnds.findIndex((end) => x(r.start) > end + 8);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      // Réserve la place du libellé à droite de la barre
      laneEnds[lane] = x(r.end) + Math.min(180, (r.label?.length ?? 6) * 5.6);
      return { r, lane };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, length]);
  const laneCount = lanes.reduce((m, l) => Math.max(m, l.lane + 1), 0);
  const H = BACKBONE_Y + 50 + laneCount * 20 + 10;

  const step = niceStep(length);
  const ticks: number[] = [1];
  for (let t = step; t < length; t += step) ticks.push(t);
  ticks.push(length);

  const active = (r: { start: number; end: number }) =>
    activeRange?.start === r.start && activeRange?.end === r.end;
  const select = (r: Region, label: string) =>
    onSelect?.({ start: r.start, end: r.end, label, color: "#7c3aed" });
  const hover = (r: Region, title: string, y: number) =>
    setTip({ x: x(r.start) + width(r) / 2, y, title, detail: `Résidus ${r.start}–${r.end} · ${r.end - r.start + 1} aa` });

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[640px]" role="img" aria-label="Architecture des domaines" onMouseLeave={() => setTip(null)}>
          {/* Règle graduée */}
          <line x1={x(1)} x2={x(length)} y1={24} y2={24} stroke="#94a3b8" />
          {ticks.map((t, i) => {
            const last = i === ticks.length - 1;
            const tooClose = !last && i > 0 && x(length) - x(t) < 30;
            return (
              <g key={`${t}-${i}`}>
                <line x1={x(t)} x2={x(t)} y1={20} y2={28} stroke="#94a3b8" />
                {!tooClose && (
                  <text x={x(t)} y={14} fontSize={11} fill="#64748b" textAnchor="middle">
                    {t}
                  </text>
                )}
                <line x1={x(t)} x2={x(t)} y1={34} y2={H - 6} stroke="#f1f5f9" />
              </g>
            );
          })}

          {/* Motifs en « sucettes » */}
          {motifs.map((m, i) => {
            const cx = x(m.start) + width(m) / 2;
            const top = 52 + (i % 2) * 14;
            return (
              <g key={`m-${i}`} className="cursor-pointer" onClick={() => select(m, m.label || "Motif")} onMouseEnter={() => hover(m, `Motif : ${m.label || "—"}`, top - 6)}>
                <line x1={cx} x2={cx} y1={top} y2={BACKBONE_Y - 12} stroke="#059669" strokeWidth={1.5} />
                <circle cx={cx} cy={top} r={active(m) ? 7 : 5} fill="#059669" stroke="white" strokeWidth={1.5} />
                <text x={cx + 9} y={top + 4} fontSize={11} fill="#065f46" fontWeight={600}>
                  {m.label}
                </text>
              </g>
            );
          })}

          {/* Squelette, coloré selon le compartiment annoté */}
          <rect x={x(1)} y={BACKBONE_Y - 3} width={x(length) - x(1)} height={6} rx={3} fill="#cbd5e1" />
          {topological.map((t, i) => {
            const side = sideOf(t.label);
            if (!side) return null;
            return (
              <rect
                key={`t-${i}`}
                x={x(t.start)}
                y={BACKBONE_Y - 3}
                width={width(t)}
                height={6}
                fill={SIDE_COLORS[side]}
                opacity={0.75}
                className="cursor-pointer"
                onMouseEnter={() => hover(t, `Domaine topologique : ${t.label}`, BACKBONE_Y - 8)}
                onClick={() => select(t, t.label || "Domaine topologique")}
              />
            );
          })}

          {/* Peptide signal */}
          {signals.map((s, i) => (
            <g key={`s-${i}`} className="cursor-pointer" onClick={() => select(s, "Peptide signal")} onMouseEnter={() => hover(s, "Peptide signal", BACKBONE_Y - 14)}>
              <rect x={x(s.start)} y={BACKBONE_Y - 9} width={width(s)} height={18} rx={3} fill="#db2777" stroke={active(s) ? "#7c3aed" : "none"} strokeWidth={2} />
            </g>
          ))}

          {/* Domaines et répétitions */}
          {domains.map((d, i) => {
            const color = DOMAIN_COLORS[i % DOMAIN_COLORS.length];
            const w = width(d);
            const label = d.label || "Domaine";
            const maxChars = Math.floor((w - 12) / 6.2);
            return (
              <g key={`d-${i}`} className="cursor-pointer" onClick={() => select(d, label)} onMouseEnter={() => hover(d, `${d.type === "repeat" ? "Répétition" : "Domaine"} : ${label}`, BACKBONE_Y - 20)}>
                <rect x={x(d.start)} y={BACKBONE_Y - 15} width={w} height={30} rx={14} fill={color} stroke={active(d) ? "#0f172a" : "white"} strokeWidth={active(d) ? 3 : 1.5} />
                <rect x={x(d.start) + 3} y={BACKBONE_Y - 12} width={Math.max(w - 6, 0)} height={10} rx={6} fill="white" opacity={0.18} />
                {maxChars >= 3 && (
                  <text x={x(d.start) + w / 2} y={BACKBONE_Y + 4} fontSize={12} fontWeight={600} fill="white" textAnchor="middle">
                    {label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Segments membranaires */}
          {membrane.map((m, i) => {
            const tm = m.type === "transmembrane";
            return (
              <rect
                key={`tm-${i}`}
                x={x(m.start)}
                y={BACKBONE_Y - (tm ? 11 : 7)}
                width={width(m)}
                height={tm ? 22 : 14}
                rx={2}
                fill={tm ? "#d97706" : "#9a3412"}
                stroke={active(m) ? "#7c3aed" : "white"}
                strokeWidth={active(m) ? 2.5 : 1}
                className="cursor-pointer"
                onClick={() => select(m, tm ? "Segment transmembranaire" : "Région intramembranaire")}
                onMouseEnter={() => hover(m, tm ? "Segment transmembranaire" : `Région intramembranaire : ${m.label || ""}`, BACKBONE_Y - 14)}
              />
            );
          })}

          {/* Régions */}
          {lanes.map(({ r, lane }, i) => {
            const y = BACKBONE_Y + 34 + lane * 20;
            return (
              <g key={`r-${i}`} className="cursor-pointer" onClick={() => select(r, r.label || "Région")} onMouseEnter={() => hover(r, `Région : ${r.label || "—"}`, y - 4)}>
                <rect x={x(r.start)} y={y} width={width(r)} height={8} rx={4} fill="#a78bfa" stroke={active(r) ? "#4c1d95" : "none"} strokeWidth={2} />
                <text x={x(r.end) + 6} y={y + 8} fontSize={11} fill="#5b21b6">
                  {r.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {tip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] shadow-md"
          style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}
        >
          <p className="font-semibold text-slate-900">{tip.title}</p>
          <p className="text-slate-600">{tip.detail}</p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-600">
        {domains.length > 0 && <Swatch color="#2563eb" round label="Domaine / répétition" />}
        {membrane.some((m) => m.type === "transmembrane") && <Swatch color="#d97706" label="Transmembranaire" />}
        {membrane.some((m) => m.type === "intramembrane") && <Swatch color="#9a3412" label="Intramembranaire" />}
        {signals.length > 0 && <Swatch color="#db2777" label="Peptide signal" />}
        {motifs.length > 0 && <Swatch color="#059669" round label="Motif" />}
        {lanes.length > 0 && <Swatch color="#a78bfa" round label="Région" />}
        {topological.length > 0 && (
          <>
            <Swatch color={SIDE_COLORS.out} label="Squelette : côté externe" />
            <Swatch color={SIDE_COLORS.in} label="Squelette : côté cytoplasmique" />
          </>
        )}
      </div>
    </div>
  );
}

function Swatch({ color, label, round = false }: { color: string; label: string; round?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-3.5 ${round ? "rounded-full" : "rounded-sm"}`} style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
