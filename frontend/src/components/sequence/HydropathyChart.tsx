"use client";

import { useMemo, useRef, useState } from "react";
import { TM_THRESHOLD, type ProfilePoint, type TMSegment } from "../../lib/sequence";

const WIDTH = 720;
const HEIGHT = 210;
const LEFT = 36;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 26;
const Y_MAX = 4;

export default function HydropathyChart({
  profile,
  sequence,
  segments,
  windowSize,
}: {
  profile: ProfilePoint[];
  sequence: string;
  segments: TMSegment[];
  windowSize: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<ProfilePoint | null>(null);

  const length = sequence.length;
  const plotW = WIDTH - LEFT - RIGHT;
  const plotH = HEIGHT - TOP - BOTTOM;
  const toX = (position: number) => LEFT + ((position - 1) / Math.max(length - 1, 1)) * plotW;
  const toY = (score: number) =>
    TOP + ((Y_MAX - Math.max(-Y_MAX, Math.min(Y_MAX, score))) / (2 * Y_MAX)) * plotH;

  const path = useMemo(() => {
    // Sous-échantillonnage : au plus ~2 points par pixel horizontal
    const step = Math.max(1, Math.floor(profile.length / (plotW * 2)));
    let d = "";
    for (let i = 0; i < profile.length; i += step) {
      const p = profile[i];
      d += `${i === 0 ? "M" : "L"}${toX(p.position).toFixed(1)},${toY(p.score).toFixed(1)}`;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, length]);

  if (!profile.length) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-[14px] text-slate-500">
        Séquence plus courte que la fenêtre ({windowSize} résidus) : profil non calculable.
      </p>
    );
  }

  const first = profile[0].position;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const position = Math.round(((x - LEFT) / plotW) * (length - 1) + 1);
    const idx = Math.max(0, Math.min(profile.length - 1, position - first));
    setHover(profile[idx]);
  };

  const hoverLeftPct = hover ? (toX(hover.position) / WIDTH) * 100 : 0;

  return (
    <div className="relative">
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[480px]"
          role="img"
          aria-label={`Profil d’hydropathie Kyte-Doolittle, fenêtre de ${windowSize} résidus`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {segments.map((seg, i) => (
            <rect
              key={i}
              x={toX(seg.start)}
              y={TOP}
              width={Math.max(toX(seg.end) - toX(seg.start), 1.5)}
              height={plotH}
              fill="#cde2fb"
              opacity="0.7"
            />
          ))}

          {[-4, -2, 0, 2, 4].map((v) => (
            <g key={v}>
              <line
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={toY(v)}
                y2={toY(v)}
                stroke={v === 0 ? "#94a3b8" : "#eef2f6"}
                strokeWidth="1"
              />
              <text x={LEFT - 6} y={toY(v) + 3} fontSize="11" fill="#64748b" textAnchor="end">
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          ))}

          <line
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={toY(TM_THRESHOLD)}
            y2={toY(TM_THRESHOLD)}
            stroke="#64748b"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <text x={WIDTH - RIGHT - 2} y={toY(TM_THRESHOLD) - 4} fontSize="11" fill="#475569" textAnchor="end">
            seuil TM {TM_THRESHOLD.toString().replace(".", ",")}
          </text>

          <path d={path} fill="none" stroke="#2a78d6" strokeWidth="2" strokeLinejoin="round" />

          {hover && (
            <g pointerEvents="none">
              <line
                x1={toX(hover.position)}
                x2={toX(hover.position)}
                y1={TOP}
                y2={TOP + plotH}
                stroke="#334155"
                strokeWidth="1"
              />
              <circle
                cx={toX(hover.position)}
                cy={toY(hover.score)}
                r="4.5"
                fill="#2a78d6"
                stroke="#ffffff"
                strokeWidth="2"
              />
            </g>
          )}

          <text x={LEFT} y={HEIGHT - 6} fontSize="11" fill="#64748b">
            1
          </text>
          <text x={LEFT + plotW / 2} y={HEIGHT - 6} fontSize="11" fill="#64748b" textAnchor="middle">
            Position (résidu)
          </text>
          <text x={WIDTH - RIGHT} y={HEIGHT - 6} fontSize="11" fill="#64748b" textAnchor="end">
            {length}
          </text>
        </svg>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] shadow-md"
          style={{ left: `clamp(60px, ${hoverLeftPct}%, calc(100% - 60px))` }}
        >
          <p className="font-semibold text-slate-900">
            {sequence[hover.position - 1]}
            {hover.position}
          </p>
          <p className="text-slate-600">
            Score : <span className="font-mono text-slate-900">{hover.score.toFixed(2)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
