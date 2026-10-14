"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useAnnotations, variantLabel, type InterProEntry } from "@/lib/annotations";
import { GROUP_COLORS } from "@/lib/phylo";
import { EvidenceBadge } from "@/components/FunctionalAnnotation";

type Range = { start: number; end: number; label?: string; color?: string };

const CATALYTIC = "#dc2626";
const BINDING = "#2563eb";
const SITE = "#7c3aed";
const VARIANT = "#0f766e";

/**
 * Signatures InterPro et bases membres (Pfam, PROSITE, SMART, CDD…) le long de
 * la séquence, avec les sites et variants fonctionnels positionnés. Clic :
 * sélection en 3D (numérotation UniProt).
 */
export default function InterProTracks({
  accession,
  length,
  activeRange,
  onFocusRange,
}: {
  accession: string;
  length: number;
  activeRange: Range | null;
  onFocusRange: (range: Range) => void;
}) {
  const { data, error, loading } = useAnnotations(accession);
  const [hover, setHover] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const groups = new Map<string, InterProEntry[]>();
    for (const e of data?.interpro.entries ?? []) {
      if (!groups.has(e.database_label)) groups.set(e.database_label, []);
      groups.get(e.database_label)!.push(e);
    }
    return [...groups.entries()];
  }, [data]);

  if (loading)
    return (
      <div className="flex items-center gap-2 py-4 text-[14px] text-slate-500">
        <Loader2 size={15} className="animate-spin text-blue-600" />
        Chargement des signatures InterPro…
      </div>
    );
  if (error || !data) return <p className="text-[14px] text-amber-800">Signatures InterPro indisponibles : {error}</p>;

  // Les signatures structurales (Gene3D, SUPERFAMILY) et PANTHER sont masquées par défaut : redondantes
  const secondary = new Set(["CATH-Gene3D", "SUPERFAMILY", "PANTHER", "PRINTS"]);
  const shownRows = rows.filter(([label]) => showAll || !secondary.has(label));
  const total = length || data.length;
  const W = 1000;
  const LEFT = 150;
  const ROW = 24;
  const x = (p: number) => LEFT + ((p - 1) / Math.max(total, 1)) * (W - LEFT - 8);
  const tracks = shownRows.length + 2;
  const height = tracks * ROW + 22;
  const functional = data.variants.filter((v) => v.functional);

  return (
    <div className="space-y-3">
      {!data.interpro.available && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{data.interpro.error}</p>}
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Signatures InterPro, sites et variants le long de la séquence" onMouseLeave={() => setHover(null)}>
        {shownRows.map(([label, entries], r) => {
          const y = r * ROW + 4;
          const color = GROUP_COLORS[r % GROUP_COLORS.length];
          return (
            <g key={label}>
              <text x={LEFT - 8} y={y + 14} fontSize={12} fontWeight={600} fill="#334155" textAnchor="end">
                {label}
              </text>
              <line x1={LEFT} x2={W - 8} y1={y + 10} y2={y + 10} stroke="#e2e8f0" strokeWidth={2} />
              {entries.flatMap((e) =>
                e.locations.map((l, k) => {
                  const active = activeRange?.start === l.start && activeRange?.end === l.end;
                  return (
                    <g
                      key={`${e.accession}-${k}`}
                      className="cursor-pointer"
                      onMouseEnter={() => setHover(`${e.database_label} ${e.accession} · ${e.name} · ${l.start}–${l.end} · prédiction par signature`)}
                      onClick={() => onFocusRange({ start: l.start, end: l.end, label: `${e.accession} ${e.name}`, color })}
                    >
                      <rect
                        x={x(l.start)}
                        y={y + 3}
                        width={Math.max(x(l.end + 1) - x(l.start), 2)}
                        height={14}
                        rx={3}
                        fill={color}
                        fillOpacity={0.85}
                        stroke={active ? "#0f172a" : "none"}
                        strokeWidth={1.5}
                      />
                      {x(l.end + 1) - x(l.start) > e.accession.length * 6.5 && (
                        <text x={(x(l.start) + x(l.end + 1)) / 2} y={y + 14} fontSize={10} fill="#ffffff" textAnchor="middle" pointerEvents="none">
                          {e.accession}
                        </text>
                      )}
                    </g>
                  );
                })
              )}
            </g>
          );
        })}

        {/* Sites (plein : expérimental, creux : prédit) */}
        {(() => {
          const y = shownRows.length * ROW + 4;
          return (
            <g>
              <text x={LEFT - 8} y={y + 14} fontSize={12} fontWeight={600} fill="#334155" textAnchor="end">
                Sites
              </text>
              <line x1={LEFT} x2={W - 8} y1={y + 10} y2={y + 10} stroke="#e2e8f0" strokeWidth={2} />
              {data.sites.map((s, k) => {
                const color = s.type === "Résidu catalytique" ? CATALYTIC : s.type === "Site de liaison" ? BINDING : SITE;
                return (
                  <circle
                    key={k}
                    cx={x((s.start + s.end) / 2)}
                    cy={y + 10}
                    r={4.5}
                    fill={s.experimental ? color : "#ffffff"}
                    stroke={color}
                    strokeWidth={1.8}
                    className="cursor-pointer"
                    onMouseEnter={() => setHover(`${s.type} ${s.start}${s.ligand ? ` · ${s.ligand}` : s.description ? ` · ${s.description}` : ""} · ${s.experimental ? "expérimental" : s.evidence_label.toLowerCase()}`)}
                    onClick={() => onFocusRange({ start: s.start, end: s.end, label: `${s.type} ${s.start}`, color })}
                  />
                );
              })}
            </g>
          );
        })()}

        {/* Variants fonctionnels */}
        {(() => {
          const y = (shownRows.length + 1) * ROW + 4;
          return (
            <g>
              <text x={LEFT - 8} y={y + 14} fontSize={12} fontWeight={600} fill="#334155" textAnchor="end">
                Variants fonctionnels
              </text>
              <line x1={LEFT} x2={W - 8} y1={y + 10} y2={y + 10} stroke="#e2e8f0" strokeWidth={2} />
              {functional.map((v, k) => (
                <rect
                  key={k}
                  x={x(v.start) - 1.5}
                  y={y + 2}
                  width={3}
                  height={16}
                  fill={v.experimental ? VARIANT : "#ffffff"}
                  stroke={VARIANT}
                  strokeWidth={1.2}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(`${v.kind} ${variantLabel(v)} · ${v.description ?? ""} · ${v.experimental ? "expérimental" : v.evidence_label.toLowerCase()}`)}
                  onClick={() => onFocusRange({ start: v.start, end: v.end, label: variantLabel(v), color: VARIANT })}
                />
              ))}
            </g>
          );
        })()}

        <text x={LEFT} y={height - 3} fontSize={10} fill="#64748b">
          1
        </text>
        <text x={W - 8} y={height - 3} fontSize={10} fill="#64748b" textAnchor="end">
          {total}
        </text>
      </svg>
      <p className="min-h-[20px] text-[12px] text-slate-600">{hover ?? "Survolez un élément ; cliquez pour le voir en 3D."}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
        <Legend color={CATALYTIC} label="Résidu catalytique" />
        <Legend color={BINDING} label="Site de liaison" />
        <Legend color={SITE} label="Autre site" />
        <span>Plein : preuve expérimentale · creux : prédiction ou inférence</span>
        {rows.some(([label]) => secondary.has(label)) && (
          <label className="ml-auto flex items-center gap-1.5">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Afficher aussi Gene3D, SUPERFAMILY, PANTHER, PRINTS
          </label>
        )}
      </div>

      {data.interpro.entries.length > 0 && (
        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-[14px] font-semibold text-slate-800 hover:bg-slate-50">Tableau des signatures ({data.interpro.entries.length})</summary>
          <div className="max-h-[300px] overflow-auto border-t border-slate-200">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">Base</th>
                  <th className="px-3 py-1.5 font-semibold">Signature</th>
                  <th className="px-3 py-1.5 font-semibold">Type</th>
                  <th className="px-3 py-1.5 font-semibold">Positions</th>
                  <th className="px-3 py-1.5 font-semibold">Nature</th>
                </tr>
              </thead>
              <tbody>
                {data.interpro.entries.map((e) => (
                  <tr key={`${e.database}-${e.accession}`} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{e.database_label}</td>
                    <td className="px-3 py-1.5">
                      <a href={e.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                        <span className="font-mono">{e.accession}</span> {e.name}
                        <ExternalLink size={10} />
                      </a>
                      {e.integrated && e.database !== "interpro" && <span className="ml-1 font-mono text-[11px] text-slate-400">→ {e.integrated}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{e.type ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{e.locations.map((l) => `${l.start}–${l.end}`).join(", ")}</td>
                    <td className="px-3 py-1.5">
                      <EvidenceBadge experimental={false} label="Prédiction (signature)" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-[12px] text-slate-500">
        Source : InterPro (EBI), correspondances calculées par InterProScan. Une signature indique une ressemblance avec une famille ou un
        domaine connus : c’est une prédiction, même quand la famille elle-même est bien caractérisée.
      </p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="12" height="12" aria-hidden>
        <circle cx="6" cy="6" r="4.5" fill={color} />
      </svg>
      {label}
    </span>
  );
}
