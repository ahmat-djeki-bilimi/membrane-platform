"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-react";
import type { ExplorerResult, SourceSegment, TopologyComparison as Comparison, TopologySourceId } from "@/lib/explorer";

const W = 1000;
const LEFT = 120;
const RIGHT = 8;
const ROW = 26;
const BAR = 12;
const TOP = 6;

const SEGMENT_COLOR = "#d97706";
const SOURCE_IDS: TopologySourceId[] = ["deeptmhmm", "uniprot", "structure", "kd"];

const CONFIDENCE = {
  forte: { label: "Forte", className: "bg-emerald-50 text-emerald-800", icon: <CheckCircle2 size={13} /> },
  moyenne: { label: "Moyenne", className: "bg-amber-50 text-amber-800", icon: <Info size={13} /> },
  faible: { label: "Faible", className: "bg-rose-50 text-rose-800", icon: <CircleAlert size={13} /> },
};

const EVIDENCE_SHORT: Record<string, string> = {
  experimental: "expérimentale",
  structure: "structure 3D",
  similarity: "similarité",
  inference: "déduction du curateur",
  predicted: "prédiction",
  unknown: "non précisée",
};

const spans = (segments?: SourceSegment[]) => (segments?.length ? segments.map((s) => `${s.start}–${s.end}`).join(", ") : "—");
const strongEvidence = (s: SourceSegment) => s.evidence === "experimental" || s.evidence === "structure";

/**
 * Segments transmembranaires selon chaque source (DeepTMHMM, UniProt,
 * structure 3D, hydropathie), segments communs avec leur confiance, et
 * divergences entre sources.
 */
export default function TopologyComparison({
  result,
  comparison,
  selected,
  onSelect,
}: {
  result: ExplorerResult;
  comparison: Comparison;
  selected: number | null;
  onSelect: (position: number) => void;
}) {
  const [hover, setHover] = useState<{ source: string; segment: SourceSegment } | null>(null);
  const length = result.length;
  const sources = SOURCE_IDS.map((id) => comparison.sources.find((s) => s.id === id)).filter((s): s is Comparison["sources"][number] => !!s);
  const plotW = W - LEFT - RIGHT;
  const x = (pos: number) => LEFT + ((pos - 1) / length) * plotW;
  const height = TOP + sources.length * ROW + 22;
  const flagged = comparison.segments.filter((s) => s.notes.length > 0);
  const s = comparison.summary;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-[16px] font-semibold text-slate-900">Comparaison des sources</h3>
        <p className="text-[13px] text-slate-500">
          {s.segments} segment(s) commun(s), dont {s.strong} confirmé(s) par plusieurs sources · {s.major_divergences} divergence(s) majeure(s),{" "}
          {s.minor_divergences} mineure(s). La source retenue pour l’analyse est marquée ★.
        </p>
      </div>

      <div className="px-4 pt-3">
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label="Segments transmembranaires selon chaque source" onMouseLeave={() => setHover(null)}>
          {/* Segments communs avec divergence : bande de fond */}
          {flagged.map((seg) => (
            <rect key={`band-${seg.id}`} x={x(seg.start)} y={TOP - 2} width={Math.max(x(seg.end + 1) - x(seg.start), 2)} height={sources.length * ROW} fill="#fef3c7" />
          ))}
          {selected && <line x1={x(selected) + plotW / length / 2} x2={x(selected) + plotW / length / 2} y1={TOP - 2} y2={TOP + sources.length * ROW} stroke="#7c3aed" strokeWidth={1.5} />}
          {sources.map((source, r) => {
            const y = TOP + r * ROW + (ROW - BAR) / 2;
            const chosen = source.id === comparison.chosen;
            return (
              <g key={source.id}>
                <text x={LEFT - 8} y={y + BAR - 2} textAnchor="end" fontSize={12} fontWeight={chosen ? 700 : 500} fill="#334155">
                  {chosen ? "★ " : ""}
                  {source.label}
                </text>
                <line x1={LEFT} x2={W - RIGHT} y1={y + BAR / 2} y2={y + BAR / 2} stroke="#cbd5e1" />
                {source.segments.map((segment) => (
                  <rect
                    key={`${source.id}-${segment.start}`}
                    x={x(segment.start)}
                    y={y}
                    width={Math.max(x(segment.end + 1) - x(segment.start), 2)}
                    height={BAR}
                    rx={2}
                    fill={SEGMENT_COLOR}
                    fillOpacity={source.id === "kd" || (source.id === "uniprot" && !strongEvidence(segment)) ? 0.45 : 1}
                    className="cursor-pointer"
                    onMouseEnter={() => setHover({ source: source.label, segment })}
                    onClick={() => onSelect(Math.round((segment.start + segment.end) / 2))}
                  />
                ))}
              </g>
            );
          })}
          <text x={LEFT} y={height - 4} fontSize={11} fill="#64748b">
            1
          </text>
          <text x={W - RIGHT} y={height - 4} fontSize={11} fill="#64748b" textAnchor="end">
            {length}
          </text>
        </svg>
        <p className="min-h-[20px] text-[13px] text-slate-600" aria-live="polite">
          {hover ? (
            <>
              <b>{hover.source}</b> : résidus {hover.segment.start}–{hover.segment.end} ({hover.segment.end - hover.segment.start + 1} résidus)
              {hover.segment.evidence_label && <> · preuve UniProt : {hover.segment.evidence_label.toLowerCase()}</>}
              {hover.segment.mean_plddt != null && <> · pLDDT moyen {Math.round(hover.segment.mean_plddt)}</>}
            </>
          ) : (
            "Survolez un segment pour le détail ; cliquez pour suivre la position dans tous les onglets."
          )}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-2 text-[12px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: SEGMENT_COLOR }} /> segment (UniProt : preuve expérimentale ou structurale)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: SEGMENT_COLOR, opacity: 0.45 }} /> UniProt prédit ou hydropathie
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-4 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> segment avec divergence
          </span>
        </div>
      </div>

      <dl className="grid gap-2 border-t border-slate-100 px-4 py-3 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
        {sources.map((source) => (
          <div key={source.id} className="rounded-md bg-slate-50 px-3 py-2">
            <dt className="font-semibold text-slate-800">
              {source.id === comparison.chosen ? "★ " : ""}
              {source.label}
            </dt>
            <dd className="text-slate-500">{source.kind}</dd>
            <dd className="text-slate-700">
              {source.count} segment(s)
              {source.n_terminus ? ` · N-terminal ${source.n_terminus === "in" ? "cytoplasmique" : "externe"}` : ""}
            </dd>
            {source.note && <dd className="text-[12px] text-slate-500">{source.note}</dd>}
          </div>
        ))}
        {!sources.some((x) => x.id === "deeptmhmm") && (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-slate-500">
            <dt className="font-semibold text-slate-800">DeepTMHMM</dt>
            <dd>
              {result.topology.deeptmhmm_status === "queued" || result.topology.deeptmhmm_status === "running"
                ? "En cours : relancez l’analyse plus tard pour l’ajouter à la comparaison."
                : result.topology.deeptmhmm_status === "failed"
                  ? "En échec sur cette séquence."
                  : "Non disponible sur ce serveur."}
            </dd>
          </div>
        )}
        {!sources.some((x) => x.id === "uniprot") && (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-slate-500">
            <dt className="font-semibold text-slate-800">UniProt</dt>
            <dd>Référence non reconnue dans UniProt : pas d’annotation à comparer.</dd>
          </div>
        )}
      </dl>

      {comparison.divergences.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="mb-1 text-[13px] font-semibold text-slate-700">Divergences entre les sources</p>
          <ul className="space-y-1 text-[13px]">
            {comparison.divergences.map((d) => (
              <li key={d.text}>
                <button
                  onClick={() => d.position && onSelect(d.position)}
                  className={`flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left ${d.position ? "hover:bg-slate-50" : "cursor-default"}`}
                >
                  <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${d.severity === "majeure" ? "text-rose-600" : "text-amber-600"}`} />
                  <span>
                    <b className={d.severity === "majeure" ? "text-rose-800" : "text-amber-800"}>{d.severity === "majeure" ? "Majeure" : "Mineure"}</b> · {d.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-1.5 font-semibold">Segment</th>
              {sources.map((source) => (
                <th key={source.id} className="px-3 py-1.5 font-semibold">
                  {source.label}
                </th>
              ))}
              <th className="px-3 py-1.5 text-right font-semibold" title="Écart maximal entre les bornes données par les sources (hydropathie exclue)">
                Écart
              </th>
              <th className="px-3 py-1.5 font-semibold">Preuve UniProt</th>
              <th className="px-3 py-1.5 font-semibold">Confiance</th>
              <th className="px-3 py-1.5 font-semibold">Remarques</th>
            </tr>
          </thead>
          <tbody>
            {comparison.segments.map((seg) => {
              const level = CONFIDENCE[seg.confidence];
              return (
                <tr key={seg.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onSelect(Math.round((seg.start + seg.end) / 2))}>
                  <td className="px-3 py-1.5 font-semibold">
                    {seg.label}
                    {!seg.in_chosen && <span className="ml-1 font-normal text-slate-500">(hors source retenue)</span>}
                  </td>
                  {sources.map((source) => (
                    <td key={source.id} className={`px-3 py-1.5 tabular-nums ${seg.sources[source.id] ? "text-slate-800" : "text-slate-400"}`}>
                      {spans(seg.sources[source.id])}
                    </td>
                  ))}
                  <td className={`px-3 py-1.5 text-right tabular-nums ${seg.shift > 5 ? "font-semibold text-amber-700" : ""}`}>{seg.shift}</td>
                  <td className="px-3 py-1.5">{seg.uniprot_evidence ? EVIDENCE_SHORT[seg.uniprot_evidence] : "—"}</td>
                  <td className="px-3 py-1.5" title={seg.confidence_reason}>
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${level.className}`}>
                      {level.icon}
                      {level.label}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{seg.notes.join(" ; ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[12px] leading-5 text-slate-500">
        Confiance : forte si toutes les sources s’accordent à ±5 résidus, ou si une annotation UniProt expérimentale ou issue d’une
        structure est confirmée par une autre source ; moyenne si plusieurs sources le donnent ; faible s’il n’y en a qu’une.
        DeepTMHMM ne fournit ici que ses segments, sans probabilité par résidu : sa confiance se lit dans l’accord avec les autres
        sources. La tranche de la structure 3D dépend de la bicouche ajustée, elle-même cherchée autour des segments retenus : ce
        n’est pas une source tout à fait indépendante.
      </p>
    </section>
  );
}
