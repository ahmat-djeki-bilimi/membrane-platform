"use client";

import { useId, useMemo, useState } from "react";
import { buildTopology, type Region, type Side } from "@/lib/topology";

type HighlightRange = { start: number; end: number; label?: string; color?: string };

const W = 1000;
const H = 400;
const MT = 165; // limite supérieure de la membrane (face externe)
const MB = 235; // limite inférieure (face interne)
const MID = (MT + MB) / 2;
const OVER = 10; // dépassement des hélices hors de la bicouche
const HELIX_W = 26;

const COLORS = {
  helix: "#d97706",
  helixDark: "#b45309",
  reentrant: "#9a3412",
  loopOut: "#e11d48",
  loopIn: "#2563eb",
  motif: "#059669",
};

type Tip = { x: number; y: number; title: string; detail: string } | null;

/**
 * Schéma de topologie membranaire (style Protter / UniProt) : bicouche
 * lipidique, hélices transmembranaires, boucles réentrantes, boucles
 * extérieures et cytoplasmiques, motifs.
 */
export default function TopologyDiagram({
  regions,
  length,
  activeRange,
  onSelect,
  residueColor,
  sidesSource = "les domaines topologiques UniProt",
}: {
  regions: Region[];
  length: number;
  activeRange?: HighlightRange | null;
  onSelect?: (range: HighlightRange) => void;
  /** Couleur de chaque résidu (ex. conservation) ; sinon couleurs par type. */
  residueColor?: (position: number) => string | undefined;
  /** Origine des côtés annotés, citée dans la légende. */
  sidesSource?: string;
}) {
  const [tip, setTip] = useState<Tip>(null);
  const uid = useId().replace(/:/g, "");
  const topology = useMemo(() => buildTopology(regions, length), [regions, length]);

  if (!topology) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-[14px] text-slate-600">
        Aucune région transmembranaire ni intramembranaire n’est annotée : pas de schéma de
        topologie membranaire pour cette protéine.
      </p>
    );
  }

  const { elements, loops } = topology;
  const n = elements.length;
  const margin = n === 1 ? W / 2 : Math.min(150, 90 + 300 / n);
  const spacing = n === 1 ? 0 : (W - 2 * margin) / (n - 1);
  const cx = (i: number) => (n === 1 ? W / 2 : margin + i * spacing);

  const boundary = (side: Side) => (side === "out" ? MT - OVER : MB + OVER);
  const dir = (side: Side) => (side === "out" ? -1 : 1);
  const loopHeight = (len: number) =>
    Math.max(22, Math.min(MT - OVER - 40, 18 + Math.sqrt(Math.max(len, 0)) * 9));

  // Points d'entrée / sortie de chaque élément
  const ends = elements.map((e, i) => {
    const entrySide = loops[i].side;
    const exitSide = loops[i + 1].side;
    if (e.kind === "tm") {
      return {
        entry: { x: cx(i), y: boundary(entrySide) },
        exit: { x: cx(i), y: boundary(exitSide) },
      };
    }
    return {
      entry: { x: cx(i) - HELIX_W / 2 + 4, y: boundary(entrySide) },
      exit: { x: cx(i) + HELIX_W / 2 - 4, y: boundary(entrySide) },
    };
  });

  const isActive = (start: number, end: number) =>
    activeRange?.start === start && activeRange?.end === end;

  const select = (start: number, end: number, label: string) =>
    onSelect?.({ start, end, label, color: "#7c3aed" });

  const show = (x: number, y: number, title: string, detail: string) =>
    setTip({ x, y, title, detail });

  // Boucles : courbes de Bézier côté extérieur ou cytoplasmique
  const loopPaths = loops.map((loop, i) => {
    const len = loop.end - loop.start + 1;
    const h = loopHeight(len);
    const d = dir(loop.side);
    const color = loop.side === "out" ? COLORS.loopOut : COLORS.loopIn;

    if (i === 0) {
      const to = ends[0].entry;
      const from = { x: Math.max(28, to.x - Math.min(70, 25 + len)), y: to.y + d * h * 0.8 };
      const c2 = { x: to.x - 10, y: to.y + d * h * 0.6 };
      return {
        loop,
        color,
        pts: [from, from, c2, to],
        d: `M ${from.x} ${from.y} C ${from.x} ${from.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`,
        apex: from,
        terminal: { label: "N", ...from },
        len,
      };
    }
    if (i === loops.length - 1) {
      const from = ends[n - 1].exit;
      const to = { x: Math.min(W - 28, from.x + Math.min(70, 25 + len)), y: from.y + d * h * 0.8 };
      const c1 = { x: from.x + 10, y: from.y + d * h * 0.6 };
      return {
        loop,
        color,
        pts: [from, c1, to, to],
        d: `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${to.x} ${to.y}, ${to.x} ${to.y}`,
        apex: to,
        terminal: { label: "C", ...to },
        len,
      };
    }
    const from = ends[i - 1].exit;
    const to = ends[i].entry;
    return {
      loop,
      color,
      pts: [from, { x: from.x, y: from.y + d * h }, { x: to.x, y: to.y + d * h }, to],
      d: `M ${from.x} ${from.y} C ${from.x} ${from.y + d * h}, ${to.x} ${to.y + d * h}, ${to.x} ${to.y}`,
      apex: { x: (from.x + to.x) / 2, y: from.y + d * h * 0.75 },
      terminal: null,
      len,
    };
  });

  // Point d'une courbe de Bézier cubique
  const bezier = (p: { x: number; y: number }[], t: number) => {
    const u = 1 - t;
    return {
      x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
      y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
    };
  };

  /** Tranches colorées d'un élément membranaire, de l'entrée vers la sortie. */
  const slices = (
    clipId: string,
    columns: { x: number; width: number; from: number; to: number; start: number; end: number }[]
  ) =>
    residueColor ? (
      <g clipPath={`url(#${clipId})`}>
        {columns.flatMap((col) => {
          const count = col.end - col.start + 1;
          if (count <= 0) return [];
          const step = (col.to - col.from) / count;
          return Array.from({ length: count }, (_, k) => {
            const y0 = col.from + k * step;
            return (
              <rect
                key={`${col.start}-${k}`}
                x={col.x}
                y={Math.min(y0, y0 + step)}
                width={col.width}
                height={Math.abs(step) + 0.4}
                fill={residueColor(col.start + k) ?? "#e2e8f0"}
              />
            );
          });
        })}
      </g>
    ) : null;

  const motifs = regions.filter((r) => r.type === "motif");
  const motifMarks = motifs.map((m) => {
    const mid = (m.start + m.end) / 2;
    const ei = elements.findIndex((e) => e.start <= mid && e.end >= mid);
    if (ei >= 0) {
      const e = elements[ei];
      const side = loops[ei].side;
      const y = e.kind === "reentrant" ? MID + dir(side) * -6 : MID;
      return { m, x: cx(ei), y };
    }
    const li = loops.findIndex((l) => l.start <= mid && l.end >= mid);
    const p = li >= 0 ? loopPaths[li].apex : { x: 20, y: 20 };
    return { m, x: p.x, y: p.y };
  });

  const heads = Math.floor(W / 11);

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[640px]"
          role="img"
          aria-label="Schéma de topologie membranaire"
          onMouseLeave={() => setTip(null)}
        >
          <defs>
            <linearGradient id="helixGrad" x1="0" x2="1">
              <stop offset="0" stopColor={COLORS.helixDark} />
              <stop offset="0.45" stopColor="#f59e0b" />
              <stop offset="1" stopColor={COLORS.helixDark} />
            </linearGradient>
            <linearGradient id="reGrad" x1="0" x2="1">
              <stop offset="0" stopColor={COLORS.reentrant} />
              <stop offset="0.5" stopColor="#c2410c" />
              <stop offset="1" stopColor={COLORS.reentrant} />
            </linearGradient>
          </defs>

          {/* Compartiments */}
          <rect x={0} y={0} width={W} height={MT - 12} fill="#fff1f2" opacity={0.6} />
          <rect x={0} y={MB + 12} width={W} height={H - MB - 12} fill="#eff6ff" opacity={0.7} />
          <text x={14} y={22} fontSize={14} fontWeight={700} fill="#be123c">
            {topology.outsideName}
          </text>
          <text x={14} y={H - 12} fontSize={14} fontWeight={700} fill="#1d4ed8">
            {topology.insideName}
          </text>

          {/* Bicouche : têtes polaires et chaînes aliphatiques */}
          <rect x={0} y={MT} width={W} height={MB - MT} fill="#fef3c7" />
          {Array.from({ length: heads }, (_, k) => {
            const x = 6 + k * 11;
            return (
              <g key={k}>
                <line x1={x - 1.5} y1={MT + 5} x2={x - 1.5} y2={MID - 3} stroke="#fcd34d" strokeWidth={1} />
                <line x1={x + 1.5} y1={MT + 5} x2={x + 1.5} y2={MID - 3} stroke="#fcd34d" strokeWidth={1} />
                <line x1={x - 1.5} y1={MB - 5} x2={x - 1.5} y2={MID + 3} stroke="#fcd34d" strokeWidth={1} />
                <line x1={x + 1.5} y1={MB - 5} x2={x + 1.5} y2={MID + 3} stroke="#fcd34d" strokeWidth={1} />
                <circle cx={x} cy={MT} r={4.6} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.8} />
                <circle cx={x} cy={MB} r={4.6} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.8} />
              </g>
            );
          })}
          <text x={W - 12} y={MID + 4} fontSize={12} fill="#92400e" textAnchor="end" fontWeight={600}>
            Membrane
          </text>

          {/* Boucles et extrémités */}
          {loopPaths.map((p, i) => (
            <g key={`loop-${i}`}>
              <path
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={isActive(p.loop.start, p.loop.end) ? 5 : 3}
                strokeLinecap="round"
                className="cursor-pointer"
                onClick={() => p.len > 0 && select(p.loop.start, p.loop.end, `Boucle ${p.loop.start}–${p.loop.end}`)}
                onMouseEnter={() =>
                  show(
                    p.apex.x,
                    p.apex.y,
                    i === 0 ? "Extrémité N-terminale" : i === loops.length - 1 ? "Extrémité C-terminale" : "Boucle",
                    p.len > 0
                      ? `${p.loop.start}–${p.loop.end} · ${p.len} résidus · ${p.loop.side === "out" ? topology.outsideName : topology.insideName}`
                      : "Aucun résidu"
                  )
                }
              />
              {/* Zone de survol élargie */}
              <path d={p.d} fill="none" stroke="transparent" strokeWidth={14} pointerEvents="stroke"
                onMouseEnter={() =>
                  show(p.apex.x, p.apex.y,
                    i === 0 ? "Extrémité N-terminale" : i === loops.length - 1 ? "Extrémité C-terminale" : "Boucle",
                    p.len > 0 ? `${p.loop.start}–${p.loop.end} · ${p.len} résidus` : "Aucun résidu")
                }
                onClick={() => p.len > 0 && select(p.loop.start, p.loop.end, `Boucle ${p.loop.start}–${p.loop.end}`)}
                className="cursor-pointer"
              />
              {p.terminal && (
                <g>
                  <circle cx={p.terminal.x} cy={p.terminal.y} r={11} fill="#0f172a" />
                  <text x={p.terminal.x} y={p.terminal.y + 4} fontSize={12} fontWeight={700} fill="white" textAnchor="middle">
                    {p.terminal.label}
                  </text>
                </g>
              )}
            </g>
          ))}

          {/* Résidus des boucles colorés (ex. conservation) */}
          {residueColor &&
            loopPaths.map((p, li) =>
              Array.from({ length: Math.max(p.len, 0) }, (_, k) => {
                const point = bezier(p.pts, (k + 0.5) / p.len);
                const color = residueColor(p.loop.start + k);
                return color ? (
                  <circle
                    key={`bead-${li}-${k}`}
                    cx={point.x}
                    cy={point.y}
                    r={p.len > 60 ? 2.4 : 3.2}
                    fill={color}
                    stroke="#475569"
                    strokeWidth={0.4}
                    pointerEvents="none"
                  />
                ) : null;
              })
            )}

          {/* Éléments membranaires */}
          {elements.map((e, i) => {
            const entrySide = loops[i].side;
            const active = isActive(e.start, e.end);
            const label =
              e.kind === "tm"
                ? `TM${elements.slice(0, i + 1).filter((x) => x.kind === "tm").length}`
                : "P";
            const title =
              e.kind === "tm"
                ? `Hélice transmembranaire ${label}`
                : `Région intramembranaire (${e.parts.map((p) => p.label).filter(Boolean).join(" ; ") || "réentrante"})`;

            if (e.kind === "tm") {
              const y = MT - OVER;
              const h = MB - MT + 2 * OVER;
              return (
                <g
                  key={`el-${i}`}
                  className="cursor-pointer"
                  onClick={() => select(e.start, e.end, label)}
                  onMouseEnter={() => show(cx(i), MT - 20, title, `Résidus ${e.start}–${e.end} · ${e.end - e.start + 1} aa`)}
                >
                  <clipPath id={`${uid}-tm-${i}`}>
                    <rect x={cx(i) - HELIX_W / 2} y={y} width={HELIX_W} height={h} rx={HELIX_W / 2} />
                  </clipPath>
                  <rect
                    x={cx(i) - HELIX_W / 2}
                    y={y}
                    width={HELIX_W}
                    height={h}
                    rx={HELIX_W / 2}
                    fill="url(#helixGrad)"
                  />
                  {slices(`${uid}-tm-${i}`, [
                    {
                      x: cx(i) - HELIX_W / 2,
                      width: HELIX_W,
                      from: entrySide === "out" ? y : y + h,
                      to: entrySide === "out" ? y + h : y,
                      start: e.start,
                      end: e.end,
                    },
                  ])}
                  <rect
                    x={cx(i) - HELIX_W / 2}
                    y={y}
                    width={HELIX_W}
                    height={h}
                    rx={HELIX_W / 2}
                    fill="none"
                    stroke={active ? "#7c3aed" : residueColor ? "#475569" : COLORS.helixDark}
                    strokeWidth={active ? 3 : 1}
                  />
                  <text
                    x={cx(i)}
                    y={MID + 4}
                    fontSize={11}
                    fontWeight={700}
                    fill="white"
                    textAnchor="middle"
                    stroke={residueColor ? "#0f172a" : "none"}
                    strokeWidth={residueColor ? 3 : 0}
                    paintOrder="stroke"
                  >
                    {label}
                  </text>
                  <text x={cx(i) + HELIX_W / 2 + 3} y={boundary(entrySide) + (entrySide === "out" ? 4 : 0)} fontSize={10} fill="#64748b">
                    {e.start}
                  </text>
                  <text x={cx(i) + HELIX_W / 2 + 3} y={boundary(loops[i + 1].side) + (loops[i + 1].side === "out" ? 4 : 0)} fontSize={10} fill="#64748b">
                    {e.end}
                  </text>
                </g>
              );
            }

            // Boucle réentrante : plonge dans la bicouche et ressort du même côté
            const top = entrySide === "out" ? MT - OVER : MID - 6;
            const bottom = entrySide === "out" ? MID + 6 : MB + OVER;
            return (
              <g
                key={`el-${i}`}
                className="cursor-pointer"
                onClick={() => select(e.start, e.end, "Région intramembranaire")}
                onMouseEnter={() => show(cx(i), entrySide === "out" ? MT - 20 : MB + 20, title, `Résidus ${e.start}–${e.end}`)}
              >
                <clipPath id={`${uid}-re-${i}`}>
                  <rect x={cx(i) - HELIX_W / 2} y={top} width={HELIX_W} height={bottom - top} rx={HELIX_W / 2} />
                </clipPath>
                <rect
                  x={cx(i) - HELIX_W / 2}
                  y={top}
                  width={HELIX_W}
                  height={bottom - top}
                  rx={HELIX_W / 2}
                  fill="url(#reGrad)"
                />
                {(() => {
                  // Descente dans la bicouche (colonne gauche) puis remontée (colonne droite)
                  const half = Math.floor((e.end - e.start + 1) / 2);
                  const outer = entrySide === "out" ? top : bottom;
                  const inner = entrySide === "out" ? bottom : top;
                  return slices(`${uid}-re-${i}`, [
                    { x: cx(i) - HELIX_W / 2, width: HELIX_W / 2, from: outer, to: inner, start: e.start, end: e.start + half - 1 },
                    { x: cx(i), width: HELIX_W / 2, from: inner, to: outer, start: e.start + half, end: e.end },
                  ]);
                })()}
                <rect
                  x={cx(i) - HELIX_W / 2}
                  y={top}
                  width={HELIX_W}
                  height={bottom - top}
                  rx={HELIX_W / 2}
                  fill="none"
                  stroke={active ? "#7c3aed" : residueColor ? "#475569" : COLORS.reentrant}
                  strokeWidth={active ? 3 : 1}
                />
                <text
                  x={cx(i)}
                  y={(top + bottom) / 2 + 4}
                  fontSize={11}
                  fontWeight={700}
                  fill="white"
                  textAnchor="middle"
                  stroke={residueColor ? "#0f172a" : "none"}
                  strokeWidth={residueColor ? 3 : 0}
                  paintOrder="stroke"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* Motifs */}
          {motifMarks.map(({ m, x, y }, i) => (
            <g
              key={`motif-${i}`}
              className="cursor-pointer"
              onClick={() => select(m.start, m.end, m.label || "Motif")}
              onMouseEnter={() => show(x, y - 12, `Motif : ${m.label || "—"}`, `Résidus ${m.start}–${m.end}`)}
            >
              <path
                d={`M ${x} ${y - 8} L ${x + 8} ${y} L ${x} ${y + 8} L ${x - 8} ${y} Z`}
                fill={COLORS.motif}
                stroke="white"
                strokeWidth={1.5}
              />
            </g>
          ))}
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

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
        <Legend swatch={<span className="h-3 w-2 rounded-full" style={{ background: COLORS.helix }} />} label="Hélice transmembranaire" />
        {elements.some((e) => e.kind === "reentrant") && (
          <Legend swatch={<span className="h-3 w-2 rounded-full" style={{ background: COLORS.reentrant }} />} label="Région intramembranaire (P)" />
        )}
        <Legend swatch={<span className="h-0.5 w-4 rounded" style={{ background: COLORS.loopOut }} />} label={`Boucle ${topology.outsideName.toLowerCase()}`} />
        <Legend swatch={<span className="h-0.5 w-4 rounded" style={{ background: COLORS.loopIn }} />} label={`Boucle ${topology.insideName.toLowerCase()}`} />
        {motifs.length > 0 && (
          <Legend swatch={<span className="h-2 w-2 rotate-45" style={{ background: COLORS.motif }} />} label="Motif" />
        )}
        <span className="ml-auto text-slate-400">
          {topology.sidesAnnotated
            ? `Côtés d’après ${sidesSource}`
            : "Côtés non annotés : orientation supposée (N-terminal cytoplasmique)"}
          {" · survolez ou cliquez un élément"}
        </span>
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
}
