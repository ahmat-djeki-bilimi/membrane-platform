"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

type Segment = { start: number; end: number; label?: string };
type HighlightRange = { start: number; end: number; label?: string; color?: string };

// Couleurs et seuils officiels d’AlphaFold DB
const BANDS = [
  { min: 90, color: "#0053d6", label: "Très élevé" },
  { min: 70, color: "#65cbf3", label: "Confiant" },
  { min: 50, color: "#ffdb13", label: "Faible" },
  { min: 0, color: "#ff7d45", label: "Très faible" },
];
const bandOf = (score: number) => BANDS.find((b) => score >= b.min) ?? BANDS[3];

const W = 1000;
const H = 190;
const LEFT = 34;
const RIGHT = 8;
const TOP = 8;
const PLOT_H = 130;
const TM_Y = TOP + PLOT_H + 10;

/**
 * Profil de confiance d’AlphaFold résidu par résidu (pLDDT), avec les
 * segments transmembranaires et les régions de faible confiance.
 */
export default function PlddtProfile({
  plddtUrl,
  sequence,
  tmSegments,
  onSelect,
}: {
  plddtUrl?: string;
  sequence?: string;
  tmSegments: Segment[];
  onSelect?: (range: HighlightRange) => void;
}) {
  const [scores, setScores] = useState<number[] | null>(null);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    setScores(null);
    setError(false);
    if (!plddtUrl) return;
    let cancelled = false;
    fetch(plddtUrl)
      .then((r) => r.json())
      .then((json) => !cancelled && setScores(json.confidenceScore ?? []))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [plddtUrl]);

  const stats = useMemo(() => {
    if (!scores?.length) return null;
    const mean = (values: number[]) =>
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

    const inTM = new Set<number>();
    tmSegments.forEach((s) => {
      for (let p = s.start; p <= s.end; p++) inTM.add(p);
    });
    const tmScores = scores.filter((_, i) => inTM.has(i + 1));
    const otherScores = scores.filter((_, i) => !inTM.has(i + 1));

    // Régions contiguës de très faible confiance (≥ 5 résidus)
    const low: { start: number; end: number; mean: number }[] = [];
    let start: number | null = null;
    scores.forEach((s, i) => {
      if (s < 50 && start === null) start = i + 1;
      if ((s >= 50 || i === scores.length - 1) && start !== null) {
        const end = s < 50 ? i + 1 : i;
        if (end - start + 1 >= 5) low.push({ start, end, mean: mean(scores.slice(start - 1, end))! });
        start = null;
      }
    });

    return { tmMean: mean(tmScores), otherMean: mean(otherScores), low };
  }, [scores, tmSegments]);

  if (!plddtUrl) return null;
  if (error) {
    return <p className="text-[13px] text-slate-500">Profil de confiance indisponible.</p>;
  }
  if (!scores) {
    return (
      <div className="flex h-[120px] items-center justify-center gap-2 text-[13px] text-slate-500">
        <Loader2 size={15} className="animate-spin text-violet-600" />
        Chargement du profil de confiance…
      </div>
    );
  }

  const n = scores.length;
  const plotW = W - LEFT - RIGHT;
  const barW = plotW / n;
  const x = (pos: number) => LEFT + (pos - 1) * barW;
  const y = (score: number) => TOP + PLOT_H - (score / 100) * PLOT_H;
  const fmt = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

  const hovered = hover != null ? { pos: hover, score: scores[hover - 1] } : null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Profil de confiance pLDDT par résidu"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const pos = Math.floor((px - LEFT) / barW) + 1;
            setHover(pos >= 1 && pos <= n ? pos : null);
          }}
        >
          {[50, 70, 90].map((t) => (
            <g key={t}>
              <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} stroke="#cbd5e1" strokeDasharray="3 4" />
              <text x={LEFT - 5} y={y(t) + 4} fontSize={12} fill="#64748b" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          <line x1={LEFT} x2={W - RIGHT} y1={y(0)} y2={y(0)} stroke="#94a3b8" />
          <text x={LEFT - 5} y={y(100) + 9} fontSize={12} fill="#64748b" textAnchor="end">
            100
          </text>

          {scores.map((s, i) => (
            <rect
              key={i}
              x={x(i + 1)}
              y={y(s)}
              width={Math.max(barW, 0.6)}
              height={y(0) - y(s)}
              fill={bandOf(s).color}
            />
          ))}

          {/* Segments transmembranaires sous l’axe */}
          <rect x={LEFT} y={TM_Y} width={plotW} height={10} rx={2} fill="#f1f5f9" />
          {tmSegments.map((s, i) => (
            <rect
              key={i}
              x={x(s.start)}
              y={TM_Y}
              width={Math.max((s.end - s.start + 1) * barW, 2)}
              height={10}
              rx={2}
              fill="#d97706"
            >
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

          {hovered && (
            <line x1={x(hovered.pos) + barW / 2} x2={x(hovered.pos) + barW / 2} y1={TOP} y2={TM_Y + 10} stroke="#0f172a" strokeWidth={1} />
          )}
        </svg>

        <div className="mt-1 h-5 text-[13px] text-slate-600" aria-live="polite">
          {hovered ? (
            <>
              Résidu{" "}
              <span className="font-mono font-semibold text-slate-900">
                {sequence?.[hovered.pos - 1] ?? ""}
                {hovered.pos}
              </span>{" "}
              · pLDDT <span className="font-semibold text-slate-900">{fmt(hovered.score)}</span> ·{" "}
              {bandOf(hovered.score).label.toLowerCase()}
            </>
          ) : (
            "Survolez le graphique pour lire la confiance de chaque résidu."
          )}
        </div>
      </div>

      {stats && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">Segments TM</p>
            <p className="text-[18px] font-bold text-slate-900">pLDDT {fmt(stats.tmMean)}</p>
            <p className="text-[12px] text-slate-500">confiance moyenne dans la membrane</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">Hors segments TM</p>
            <p className="text-[18px] font-bold text-slate-900">pLDDT {fmt(stats.otherMean)}</p>
            <p className="text-[12px] text-slate-500">boucles et extrémités</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">Régions peu fiables</p>
            <p className="text-[18px] font-bold text-slate-900">{stats.low.length}</p>
            <p className="text-[12px] text-slate-500">pLDDT &lt; 50 sur au moins 5 résidus</p>
          </div>
        </div>
      )}

      {stats && stats.low.length > 0 && (
        <div>
          <p className="mb-1 text-[13px] font-semibold text-slate-800">Régions de très faible confiance</p>
          <div className="flex flex-wrap gap-1.5">
            {stats.low.map((r) => (
              <button
                key={r.start}
                onClick={() => onSelect?.({ start: r.start, end: r.end, label: `pLDDT < 50 · ${r.start}–${r.end}`, color: "#ff7d45" })}
                className="rounded border border-orange-200 bg-orange-50 px-2 py-0.5 font-mono text-[12px] text-orange-800 hover:bg-orange-100"
                title="Voir en 3D"
              >
                {r.start}–{r.end}
                <span className="ml-1 opacity-70">({r.end - r.start + 1} aa · {fmt(r.mean)})</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] leading-4 text-slate-500">
            Ces régions sont souvent intrinsèquement désordonnées (extrémités, longues boucles) :
            leur forme dans le modèle n’est pas fiable.
          </p>
        </div>
      )}
    </div>
  );
}
