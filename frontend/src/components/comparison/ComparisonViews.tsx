"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import { gradeColor, useConservation, type ConservationResult } from "@/lib/conservation";
import {
  RELIABILITY_LABELS,
  columnOf,
  columnRange,

  pairKey,
  proteinColor,
  type ComparisonResult,
  type PairComparison,
} from "@/lib/comparison";
import { GROUP_COLORS } from "@/lib/phylo";

const SuperposedViewer = dynamic(() => import("./SuperposedViewer"), { ssr: false });

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`);
const evalue = (v: number) => (v === 0 ? "0" : v < 0.01 ? v.toExponential(1).replace("e", "e") : v.toFixed(2));

// Groupes d'acides aminés semblables (groupes « forts » de Clustal)
const SIMILAR_GROUPS = ["STA", "NEQK", "NHQK", "NDEQ", "QHRK", "MILV", "MILF", "HY", "FYW"];
const similar = (a: string, b: string) => a === b || SIMILAR_GROUPS.some((g) => g.includes(a) && g.includes(b));

export type ColumnProps = { result: ComparisonResult; column: number | null; onColumn: (column: number | null) => void };

// ---------------------------------------------------------------------------
// Éléments communs
// ---------------------------------------------------------------------------

export function Section({ title, subtitle, children, right }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-[13px] text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ProteinLabel({ result, p, short = false }: { result: ComparisonResult; p: number; short?: boolean }) {
  const protein = result.proteins[p];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: proteinColor(p) }} />
      <span className="font-mono font-semibold">{protein.accession}</span>
      {!short && protein.gene && <span className="text-slate-500">{protein.gene}</span>}
      {p === result.reference && <span className="text-[11px] font-semibold text-amber-700">réf.</span>}
    </span>
  );
}

function ReliabilityBadge({ level }: { level: PairComparison["reliability"] }) {
  const tone = level === "fiable" ? "bg-emerald-50 text-emerald-800" : level === "a_verifier" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-800";
  const icon = level === "fiable" ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ${tone}`}>
      {icon}
      {RELIABILITY_LABELS[level]}
    </span>
  );
}

/** Matrice symétrique protéine × protéine, teinte proportionnelle à la valeur (0–1). */
function PairMatrix({
  result,
  value,
  format,
  selected,
  onSelect,
  higherIsCloser = true,
}: {
  result: ComparisonResult;
  value: (a: number, b: number) => number | null;
  format: (v: number) => string;
  selected?: [number, number] | null;
  onSelect?: (a: number, b: number) => void;
  higherIsCloser?: boolean;
}) {
  const n = result.proteins.length;
  const values = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) values.push(value(a, b));
  const finite = values.filter((v): v is number => v != null);
  const lo = Math.min(...finite, 0);
  const hi = Math.max(...finite, 1e-9);
  const shade = (v: number) => {
    const t = (v - lo) / (hi - lo || 1);
    const s = higherIsCloser ? t : 1 - t;
    return `rgba(15, 76, 129, ${0.08 + 0.8 * s})`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="text-[13px]">
        <thead>
          <tr>
            <th />
            {result.proteins.map((_, b) => (
              <th key={b} className="px-2 py-1 text-left font-normal">
                <ProteinLabel result={result} p={b} short />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.proteins.map((_, a) => (
            <tr key={a}>
              <th className="px-2 py-1 text-left font-normal">
                <ProteinLabel result={result} p={a} short />
              </th>
              {result.proteins.map((__, b) => {
                if (a === b) return <td key={b} className="h-10 w-20 bg-slate-50 text-center text-slate-300">—</td>;
                const v = value(a, b);
                const active = selected && ((selected[0] === a && selected[1] === b) || (selected[0] === b && selected[1] === a));
                const dark = v != null && (higherIsCloser ? (v - lo) / (hi - lo || 1) : 1 - (v - lo) / (hi - lo || 1)) > 0.55;
                return (
                  <td key={b} className="p-0.5">
                    <button
                      onClick={() => onSelect?.(a, b)}
                      className={`h-10 w-20 rounded text-center font-semibold tabular-nums ${active ? "ring-2 ring-violet-600" : ""} ${dark ? "text-white" : "text-slate-800"}`}
                      style={{ backgroundColor: v == null ? "#f1f5f9" : shade(v) }}
                    >
                      {v == null ? "—" : format(v)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TrackItem = { start: number; end: number; color: string; label?: string; title: string; opacity?: number };

/** Pistes alignées sur les colonnes de l'alignement commun (une par protéine). */
export function Tracks({
  result,
  items,
  column,
  onColumn,
  rowNote,
}: ColumnProps & { items: TrackItem[][]; rowNote?: (p: number) => string | null }) {
  const W = 1000;
  const LEFT = 130;
  const ROW = 26;
  const total = result.alignment.columns.length;
  const x = (c: number) => LEFT + (c / total) * (W - LEFT - 8);
  const height = result.proteins.length * ROW + 18;
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Pistes alignées" onMouseLeave={() => setHover(null)}>
        {result.proteins.map((protein, p) => {
          const y = p * ROW + 4;
          return (
            <g key={p}>
              <rect x={6} y={y + 6} width={10} height={10} rx={2} fill={proteinColor(p)} />
              <text x={22} y={y + 15} fontSize={12} fontWeight={600} fill="#1e293b">
                {protein.accession}
              </text>
              {rowNote?.(p) && (
                <text x={LEFT - 6} y={y + 15} fontSize={10} fill="#64748b" textAnchor="end">
                  {rowNote(p)}
                </text>
              )}
              <line x1={LEFT} x2={W - 8} y1={y + 11} y2={y + 11} stroke="#e2e8f0" strokeWidth={2} />
              {items[p].map((item, k) => (
                <g key={k} className="cursor-pointer" onMouseEnter={() => setHover(item.title)} onClick={() => onColumn(Math.round((item.start + item.end) / 2))}>
                  <rect x={x(item.start)} y={y + 3} width={Math.max(x(item.end + 1) - x(item.start), 1.5)} height={16} rx={2} fill={item.color} fillOpacity={item.opacity ?? 1} />
                  {item.label && x(item.end + 1) - x(item.start) > item.label.length * 6.5 && (
                    <text x={(x(item.start) + x(item.end + 1)) / 2} y={y + 15} fontSize={10} fill="#ffffff" textAnchor="middle" pointerEvents="none">
                      {item.label}
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        })}
        {column != null && <line x1={x(column + 0.5)} x2={x(column + 0.5)} y1={0} y2={height - 14} stroke="#7c3aed" strokeWidth={1.5} />}
        <text x={LEFT} y={height - 2} fontSize={10} fill="#64748b">
          colonne 1
        </text>
        <text x={W - 8} y={height - 2} fontSize={10} fill="#64748b" textAnchor="end">
          {total}
        </text>
      </svg>
      <p className="min-h-[20px] text-[12px] text-slate-600">{hover ?? "Survolez un élément ; cliquez pour sélectionner la colonne correspondante dans tous les onglets."}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vue d'ensemble
// ---------------------------------------------------------------------------

export function OverviewTab({ result, onTab }: { result: ComparisonResult; onTab: (tab: string) => void }) {
  const n = result.proteins.length;
  const warnings: string[] = [];
  for (const [key, pair] of Object.entries(result.pairwise)) {
    const [a, b] = key.split("-").map(Number);
    if (pair.reliability !== "fiable")
      warnings.push(`${result.proteins[a].accession} / ${result.proteins[b].accession} : ${pair.reliability_text}`);
    const s = result.structures.pairs[key];
    if (s && Math.max(s.tm_score_a, s.tm_score_b) < 0.5)
      warnings.push(`${result.proteins[a].accession} / ${result.proteins[b].accession} : TM-score < 0,5, les modèles n’ont probablement pas le même repliement.`);
  }
  const unique = result.domains.filter((d) => d.shared === 1 && n > 1);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {result.proteins.map((protein, p) => {
          const model = result.structures.models[p];
          return (
            <div key={protein.accession} className="card p-3" style={{ borderTop: `4px solid ${proteinColor(p)}` }}>
              <p className="flex items-center justify-between gap-2">
                <ProteinLabel result={result} p={p} />
                <Link href={`/structures/${protein.accession}`} className="text-[12px] font-semibold text-blue-700 hover:underline">
                  Fiche
                </Link>
              </p>
              <p className="mt-1 text-[14px] font-semibold text-slate-900">{protein.name}</p>
              <p className="text-[13px] italic text-slate-500">{protein.organism}</p>
              <p className="mt-1 text-[13px] text-slate-700">
                {protein.length} résidus · {protein.topology.segments.length} segment(s) TM · {protein.domains.length} domaine(s) annoté(s)
              </p>
              <p className="text-[13px] text-slate-500">
                {model.available ? `Modèle AlphaFold, pLDDT moyen ${model.mean_plddt}${model.same_sequence ? "" : " (séquence différente : non superposé)"}` : "Pas de modèle AlphaFold"}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Identité de séquence" subtitle="Résidus identiques parmi les paires alignées. Cliquez une case pour le détail de la paire." right={<button onClick={() => onTab("sequences")} className="text-[13px] font-semibold text-blue-700 hover:underline">Séquences →</button>}>
          <PairMatrix result={result} value={(a, b) => result.pairwise[pairKey(a, b)]?.identity ?? null} format={(v) => pct(v)} onSelect={() => onTab("sequences")} />
        </Section>
        <Section title="Similarité des structures" subtitle="TM-score (normalisé par la plus courte) : > 0,5, même repliement." right={<button onClick={() => onTab("structures")} className="text-[13px] font-semibold text-blue-700 hover:underline">Structures →</button>}>
          <PairMatrix
            result={result}
            value={(a, b) => {
              const s = result.structures.pairs[pairKey(a, b)];
              return s ? Math.max(s.tm_score_a, s.tm_score_b) : null;
            }}
            format={(v) => v.toFixed(2)}
            onSelect={() => onTab("structures")}
          />
        </Section>
      </div>

      <Section title="Principales différences et points de vigilance">
        <ul className="list-disc space-y-1 pl-5 text-[14px] text-slate-700">
          {result.topology.differences.map((d) => (
            <li key={d}>{d}</li>
          ))}
          {unique.slice(0, 8).map((d) => {
            const owner = Object.entries(d.proteins).find(([, v]) => v.length)?.[0];
            return (
              <li key={`${d.type}-${d.name}`}>
                {d.type} « {d.name} » seulement chez {owner != null ? result.proteins[Number(owner)].accession : "?"}.
              </li>
            );
          })}
          {warnings.map((w) => (
            <li key={w} className="text-amber-800">
              {w}
            </li>
          ))}
          {result.topology.differences.length + unique.length + warnings.length === 0 && <li>Aucune différence majeure de topologie ou de domaines ; correspondance des résidus fiable.</li>}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Séquences
// ---------------------------------------------------------------------------

type MatrixMode = "identity" | "similarity" | "coverage" | "evalue";

export function SequencesTab({ result, column, onColumn }: ColumnProps) {
  const others = result.proteins.map((_, p) => p).filter((p) => p !== result.reference);
  const [pair, setPair] = useState<[number, number]>([result.reference, others[0]]);
  const [mode, setMode] = useState<MatrixMode>("identity");
  const detail = result.pairwise[pairKey(pair[0], pair[1])];
  const [a, b] = pair;
  const flipped = a > b;
  const index = useMemo(() => columnOf(result, a), [result, a]);

  const value = (x: number, y: number) => {
    const d = result.pairwise[pairKey(x, y)];
    if (!d) return null;
    if (mode === "identity") return d.identity;
    if (mode === "similarity") return d.similarity;
    if (mode === "coverage") return x < y ? d.coverage_a : d.coverage_b;
    return -Math.log10(Math.max(d.evalue, 1e-300));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[auto_1fr]">
        <Section
          title="Matrice des paires"
          subtitle={mode === "coverage" ? "Part de la protéine de la ligne alignée sur celle de la colonne." : mode === "evalue" ? "−log10(E-value) : plus c’est grand, plus l’homologie est sûre." : undefined}
        >
          <SegmentedControl
            label="Mesure"
            value={mode}
            onChange={setMode}
            options={[
              { value: "identity", label: "Identité" },
              { value: "similarity", label: "Similarité" },
              { value: "coverage", label: "Couverture" },
              { value: "evalue", label: "E-value" },
            ]}
          />
          <div className="mt-3">
            <PairMatrix result={result} value={value} format={(v) => (mode === "evalue" ? v.toFixed(0) : pct(v))} selected={pair} onSelect={(x, y) => setPair([x, y])} />
          </div>
        </Section>

        {detail && (
          <Section
            title="Correspondance des résidus"
            subtitle={
              <>
                <ProteinLabel result={result} p={a} short /> face à <ProteinLabel result={result} p={b} short />
              </>
            }
            right={<ReliabilityBadge level={detail.reliability} />}
          >
            <p className="text-[14px] text-slate-700">{detail.reliability_text}</p>
            <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
              <Fact label="Résidus alignés" value={`${detail.aligned}`} />
              <Fact label="Identité / similarité" value={`${pct(detail.identity)} / ${pct(detail.similarity)}`} />
              <Fact label="Couverture" value={`${pct(flipped ? detail.coverage_b : detail.coverage_a)} / ${pct(flipped ? detail.coverage_a : detail.coverage_b)}`} />
              <Fact label="Score et E-value" value={`${detail.bits} bits · E = ${evalue(detail.evalue)}`} />
              <Fact label="Confirmée par la structure" value={detail.structure_confirmed != null ? `${pct(detail.structure_confirmed)} des paires à < 4 Å` : "modèles indisponibles"} />
              <Fact label="Régions douteuses" value={`${detail.doubtful.length}`} />
            </dl>
            {detail.doubtful.length > 0 && (
              <p className="mt-2 text-[13px] text-amber-800">
                Résidus alignés peu semblables (correspondance incertaine) :{" "}
                {detail.doubtful.map((d, k) => {
                  const ra = flipped ? d.b : d.a;
                  const rb = flipped ? d.a : d.b;
                  return (
                    <button key={k} onClick={() => onColumn(index.get(ra[0]) ?? null)} className="mr-2 font-mono hover:underline">
                      {ra[0]}–{ra[1]} ↔ {rb[0]}–{rb[1]}
                    </button>
                  );
                })}
              </p>
            )}
            {detail.structure_confirmed != null && detail.structure_confirmed < 0.7 && (
              <p className="mt-2 text-[13px] text-amber-800">
                Moins de 70 % des paires de résidus sont proches après superposition : une partie de l’alignement de séquence est
                probablement décalée ; fiez-vous aux régions confirmées (onglet Structures 3D).
              </p>
            )}
          </Section>
        )}
      </div>

      <Section title="Alignement" subtitle={`Colonnes communes aux ${result.proteins.length} protéines (repère : ${result.proteins[result.reference].accession}). Fond bleu foncé : identique à la référence ; clair : semblable ; gris : insertion sans équivalent dans la référence.`}>
        <AlignmentViewer result={result} column={column} onColumn={onColumn} />
      </Section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

const BLOCK = 60;

function AlignmentViewer({ result, column, onColumn }: ColumnProps) {
  const { rows, kinds, columns } = result.alignment;
  const ref = rows[result.reference];
  const total = rows[0].length;
  const blocks = Math.ceil(total / BLOCK);
  return (
    <div className="space-y-3 overflow-x-auto font-mono text-[12px]">
      {Array.from({ length: blocks }, (_, block) => {
        const start = block * BLOCK;
        const end = Math.min(start + BLOCK, total);
        return (
          <div key={block} className="min-w-max">
            <div className="flex">
              <span className="w-28 shrink-0" />
              <span className="w-12 shrink-0" />
              {Array.from({ length: end - start }, (_, k) => (
                <span key={k} className="inline-block w-[13px] text-center text-[10px] text-slate-400">
                  {(start + k + 1) % 10 === 0 ? "|" : ""}
                </span>
              ))}
            </div>
            {rows.map((row, p) => {
              const first = columns.slice(start, end).find((c) => c[p])?.[p];
              const last = [...columns.slice(start, end)].reverse().find((c) => c[p])?.[p];
              return (
                <div key={p} className="flex items-center">
                  <span className="w-28 shrink-0 truncate font-sans font-semibold" style={{ color: proteinColor(p) }}>
                    {result.proteins[p].accession}
                  </span>
                  <span className="w-12 shrink-0 pr-1 text-right text-slate-400">{first ?? ""}</span>
                  {Array.from({ length: end - start }, (_, k) => {
                    const c = start + k;
                    const residue = row[c];
                    const insertion = kinds[c] === "insertion";
                    let style: React.CSSProperties = {};
                    let className = "text-slate-700";
                    if (residue === "-") className = "text-slate-300";
                    else if (insertion) style = { backgroundColor: "#f1f5f9", color: "#94a3b8" };
                    else if (p !== result.reference && residue === ref[c]) style = { backgroundColor: "#1d4ed8", color: "#ffffff" };
                    else if (p !== result.reference && ref[c] !== "-" && similar(residue, ref[c])) style = { backgroundColor: "#bfdbfe" };
                    return (
                      <span
                        key={k}
                        onClick={() => onColumn(c === column ? null : c)}
                        title={`Colonne ${c + 1}${columns[c][p] ? ` · ${result.proteins[p].accession} ${residue}${columns[c][p]}` : ""}`}
                        className={`inline-block w-[13px] cursor-pointer text-center ${className} ${column === c ? "outline outline-2 outline-violet-600" : ""}`}
                        style={style}
                      >
                        {residue}
                      </span>
                    );
                  })}
                  <span className="pl-1 text-slate-400">{last ?? ""}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structures 3D
// ---------------------------------------------------------------------------

export function StructuresTab({ result, column, onColumn }: ColumnProps) {
  const [metric, setMetric] = useState<"tm" | "rmsd" | "confirmed">("tm");
  const selected = column != null ? result.alignment.columns[column] : null;
  const anyModel = result.structures.superposed.length > 1;
  return (
    <div className="space-y-4">
      {!anyModel && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
          Moins de deux modèles AlphaFold utilisables : la comparaison des structures n’est pas possible pour cette sélection.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Section title="Modèles superposés" subtitle={`Superposés sur ${result.proteins[result.reference].accession} à partir des résidus alignés de pLDDT ≥ 70. Colonne sélectionnée en bâtonnets.`}>
          {anyModel ? <SuperposedViewer result={result} selectedResidues={selected} /> : <p className="text-[14px] text-slate-500">—</p>}
        </Section>
        <div className="space-y-4">
          <Section title="Comparaison des paires">
            <SegmentedControl
              label="Mesure"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "tm", label: "TM-score" },
                { value: "rmsd", label: "RMSD (Å)" },
                { value: "confirmed", label: "Paires < 4 Å" },
              ]}
            />
            <div className="mt-3">
              <PairMatrix
                result={result}
                higherIsCloser={metric !== "rmsd"}
                value={(a, b) => {
                  const s = result.structures.pairs[pairKey(a, b)];
                  if (!s) return null;
                  if (metric === "rmsd") return s.rmsd;
                  if (metric === "confirmed") return s.confirmed;
                  // Normalisé par la longueur de la protéine de la ligne
                  return a < b ? s.tm_score_a : s.tm_score_b;
                }}
                format={(v) => (metric === "rmsd" ? v.toFixed(1) : metric === "confirmed" ? pct(v) : v.toFixed(2))}
              />
            </div>
            <p className="mt-2 text-[12px] leading-5 text-slate-500">
              TM-score normalisé par la protéine de la ligne : &gt; 0,5 même repliement, &gt; 0,8 structures très proches. RMSD sur les
              résidus fiables superposés. Ce sont des modèles prédits : un écart peut venir du modèle lui-même (voir le pLDDT).
            </p>
          </Section>
          <Section title="Disponibilité des modèles">
            <ul className="space-y-1 text-[13px]">
              {result.proteins.map((protein, p) => {
                const m = result.structures.models[p];
                return (
                  <li key={protein.accession} className="flex flex-wrap items-center gap-2">
                    <ProteinLabel result={result} p={p} short />
                    <span className="text-slate-600">
                      {!m.available ? "aucun modèle AlphaFold" : !m.same_sequence ? "modèle calculé sur une autre séquence : non superposé" : `${m.model_id}, pLDDT moyen ${m.mean_plddt}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>
      </div>
      {anyModel && <DistanceProfile result={result} column={column} onColumn={onColumn} />}
    </div>
  );
}

/** Écart Cα après superposition, le long de la référence, pour chaque autre protéine. */
function DistanceProfile({ result, column, onColumn }: ColumnProps) {
  const ref = result.reference;
  const index = useMemo(() => columnOf(result, ref), [result, ref]);
  const series = result.proteins
    .map((_, p) => p)
    .filter((p) => p !== ref)
    .map((p) => {
      const s = result.structures.pairs[pairKey(ref, p)];
      if (!s) return null;
      const points = s.distances.map(([x, y, d]) => (ref < p ? [x, d] : [y, d]) as [number, number]).sort((u, v) => u[0] - v[0]);
      return { p, points };
    })
    .filter((s): s is { p: number; points: [number, number][] } => !!s);
  const W = 1000;
  const H = 200;
  const L = 36;
  const n = result.proteins[ref].length;
  const max = 10;
  const x = (r: number) => L + ((r - 1) / Math.max(n - 1, 1)) * (W - L - 8);
  const y = (d: number) => 8 + (1 - Math.min(d, max) / max) * (H - 30);
  const selectedResidue = column != null ? result.alignment.columns[column][ref] : null;
  return (
    <Section title={`Écart entre résidus correspondants (le long de ${result.proteins[ref].accession})`} subtitle="Distance entre Cα alignés après superposition, plafonnée à 10 Å. Sous 4 Å (ligne) : correspondance confirmée par la structure. Cliquez pour sélectionner la colonne.">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        role="img"
        aria-label="Écart entre résidus correspondants"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const residue = Math.round((((e.clientX - rect.left) / rect.width) * W - L) / ((W - L - 8) / Math.max(n - 1, 1))) + 1;
          onColumn(index.get(residue) ?? null);
        }}
      >
        {[0, 4, 10].map((d) => (
          <g key={d}>
            <line x1={L} x2={W - 8} y1={y(d)} y2={y(d)} stroke={d === 4 ? "#94a3b8" : "#eef2f6"} strokeDasharray={d === 4 ? "4 3" : undefined} />
            <text x={L - 4} y={y(d) + 4} fontSize={10} fill="#64748b" textAnchor="end">
              {d}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <polyline key={s.p} points={s.points.map(([r, d]) => `${x(r)},${y(d)}`).join(" ")} fill="none" stroke={proteinColor(s.p)} strokeWidth={1.5} />
        ))}
        {selectedResidue && <line x1={x(selectedResidue)} x2={x(selectedResidue)} y1={4} y2={H - 22} stroke="#7c3aed" strokeWidth={1.5} />}
        <text x={L} y={H - 4} fontSize={10} fill="#64748b">
          1
        </text>
        <text x={W - 8} y={H - 4} fontSize={10} fill="#64748b" textAnchor="end">
          {n}
        </text>
      </svg>
      <div className="flex flex-wrap gap-3 text-[12px] text-slate-600">
        {series.map((s) => (
          <span key={s.p} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ backgroundColor: proteinColor(s.p) }} />
            {result.proteins[s.p].accession}
          </span>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Domaines
// ---------------------------------------------------------------------------

export function DomainsTab({ result, column, onColumn }: ColumnProps) {
  const colors = new Map(result.domains.slice(0, GROUP_COLORS.length).map((d, k) => [`${d.type}|${d.name}`, GROUP_COLORS[k]]));
  const items = result.proteins.map((_, p) =>
    result.domains.flatMap((d) =>
      d.proteins[String(p)]
        .filter((r) => r.columns)
        .map((r) => ({
          start: r.columns!.start - 1,
          end: r.columns!.end - 1,
          color: colors.get(`${d.type}|${d.name}`) ?? "#64748b",
          label: d.name,
          title: `${result.proteins[p].accession} · ${d.type} « ${d.name} » : résidus ${r.start}–${r.end}`,
        }))
    )
  );
  return (
    <div className="space-y-4">
      <Section title="Domaines dans l’alignement commun" subtitle="Domaines, répétitions, motifs et peptides signal annotés dans UniProt, placés sur les colonnes de l’alignement.">
        {result.domains.length ? <Tracks result={result} items={items} column={column} onColumn={onColumn} /> : <p className="text-[14px] text-slate-500">Aucun domaine annoté dans UniProt pour ces protéines.</p>}
      </Section>
      {result.domains.length > 0 && (
        <Section title="Tableau des domaines">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-2 py-1 font-semibold">Élément</th>
                  {result.proteins.map((_, p) => (
                    <th key={p} className="px-2 py-1 font-normal">
                      <ProteinLabel result={result} p={p} short />
                    </th>
                  ))}
                  <th className="px-2 py-1 font-semibold">Partagé</th>
                  <th className="px-2 py-1 text-right font-semibold" title="Recouvrement, dans l’alignement, des domaines de même nom">
                    Aligné
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.domains.map((d) => (
                  <tr key={`${d.type}-${d.name}`} className="border-t border-slate-100">
                    <td className="px-2 py-1">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors.get(`${d.type}|${d.name}`) ?? "#64748b" }} />
                      {d.name} <span className="text-slate-400">({d.type.toLowerCase()})</span>
                    </td>
                    {result.proteins.map((_, p) => (
                      <td key={p} className="px-2 py-1 tabular-nums text-slate-700">
                        {d.proteins[String(p)].map((r) => `${r.start}–${r.end}`).join(", ") || <span className="text-slate-300">absent</span>}
                      </td>
                    ))}
                    <td className="px-2 py-1">{d.shared === result.proteins.length ? "toutes" : `${d.shared} / ${result.proteins.length}`}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${d.aligned_overlap != null && d.aligned_overlap < 0.5 ? "text-amber-700" : ""}`}>{pct(d.aligned_overlap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-slate-500">
            « Aligné » : part d’un domaine qui tombe sur les mêmes colonnes que le domaine de même nom de l’autre protéine. Un faible
            recouvrement signale un domaine annoté à des positions qui ne se correspondent pas (ou un alignement à vérifier).
          </p>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topologie
// ---------------------------------------------------------------------------

const TOPOLOGY_SOURCE: Record<string, string> = { uniprot: "UniProt", deeptmhmm: "DeepTMHMM", kd: "hydropathie (estimée)", user: "fournie" };

export function TopologyTab({ result, column, onColumn }: ColumnProps) {
  const indexes = useMemo(() => result.proteins.map((_, p) => columnOf(result, p)), [result]);
  const items = result.proteins.map((protein, p) =>
    protein.topology.segments
      .map((s, k) => {
        const range = columnRange(indexes[p], s.start, s.end);
        return range
          ? { start: range[0], end: range[1], color: "#d97706", opacity: protein.topology.source === "kd" ? 0.5 : 1, label: s.label ?? `TM${k + 1}`, title: `${protein.accession} · ${s.label ?? `TM${k + 1}`} : résidus ${s.start}–${s.end}` }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
  );
  return (
    <div className="space-y-4">
      <Section title="Segments transmembranaires dans l’alignement commun" subtitle="Plus clair : topologie estimée par hydropathie, à confirmer.">
        <Tracks
          result={result}
          items={items}
          column={column}
          onColumn={onColumn}
          rowNote={(p) => {
            const t = result.proteins[p].topology;
            return t.n_terminus ? `N ${t.n_terminus === "in" ? "cyto." : "ext."}` : null;
          }}
        />
      </Section>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Correspondance des segments">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-2 py-1 font-semibold">Segment commun</th>
                  {result.proteins.map((_, p) => (
                    <th key={p} className="px-2 py-1 font-normal">
                      <ProteinLabel result={result} p={p} short />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.topology.segments.map((s) => (
                  <tr key={s.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onColumn(Math.round((s.columns[0] + s.columns[1]) / 2) - 1)}>
                    <td className="px-2 py-1 font-semibold">
                      {s.id} <span className="font-normal text-slate-400">col. {s.columns[0]}–{s.columns[1]}</span>
                    </td>
                    {result.proteins.map((_, p) => {
                      const ranges = s.proteins[String(p)];
                      return (
                        <td key={p} className={`px-2 py-1 tabular-nums ${ranges.length ? "text-slate-800" : "font-semibold text-rose-700"}`}>
                          {ranges.length ? ranges.map(([a, b]) => `${a}–${b}`).join(", ") : "absent"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Différences">
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-700">
            {result.topology.differences.map((d) => (
              <li key={d}>{d}</li>
            ))}
            {result.topology.differences.length === 0 && <li>Mêmes segments aux mêmes positions de l’alignement, même orientation.</li>}
          </ul>
          <p className="mt-2 text-[12px] text-slate-500">
            Sources : {result.proteins.map((p) => `${p.accession} ${TOPOLOGY_SOURCE[p.topology.source] ?? p.topology.source}`).join(" · ")}. Deux segments se
            correspondent s’ils se recouvrent d’au moins 5 colonnes dans l’alignement.
          </p>
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conservation
// ---------------------------------------------------------------------------

/** Charge la conservation d'une protéine (calcul en file) et la remonte au parent. */
function ConservationLoader({ accession, onState }: { accession: string; onState: (accession: string, state: { status: string; result: ConservationResult | null; error: string | null }) => void }) {
  const state = useConservation(accession);
  useEffect(() => {
    onState(accession, { status: state.status, result: state.result, error: state.error });
  }, [accession, state.status, state.result, state.error, onState]);
  return null;
}

export function ConservationTab({ result, column, onColumn }: ColumnProps) {
  const [states, setStates] = useState<Record<string, { status: string; result: ConservationResult | null; error: string | null }>>({});
  const onState = useMemo(
    () => (accession: string, state: { status: string; result: ConservationResult | null; error: string | null }) =>
      setStates((s) => (s[accession]?.status === state.status && s[accession]?.result === state.result ? s : { ...s, [accession]: state })),
    []
  );
  const grades = result.proteins.map((p) => {
    const r = states[p.accession]?.result;
    return r ? new Map(r.positions.map((x) => [x.position, x.grade])) : null;
  });
  const columns = result.alignment.columns;
  const items = result.proteins.map((_, p) => {
    const g = grades[p];
    if (!g) return [];
    return columns.flatMap((c, k) => (c[p] && g.get(c[p]!) != null ? [{ start: k, end: k, color: gradeColor(g.get(c[p]!)!), title: `${result.proteins[p].accession} ${result.alignment.rows[p][k]}${c[p]} · grade ${g.get(c[p]!)}/9` }] : []));
  });

  const ready = grades.filter(Boolean).length;
  const table = useMemo(() => {
    if (ready < 2) return null;
    const shared: number[] = [];
    const divergent: number[] = [];
    columns.forEach((c, k) => {
      if (result.alignment.kinds[k] !== "reference") return;
      const values = c.map((r, p) => (r && grades[p] ? grades[p]!.get(r) ?? null : null)).filter((v): v is number => v != null);
      if (values.length < 2) return;
      if (values.every((v) => v >= 8)) shared.push(k);
      else if (Math.max(...values) >= 8 && Math.min(...values) <= 4) divergent.push(k);
    });
    return { shared, divergent };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, states, result]);

  const describe = (k: number) =>
    result.proteins
      .map((protein, p) => {
        const r = columns[k][p];
        return r ? `${result.alignment.rows[p][k]}${r}${grades[p] ? `(${grades[p]!.get(r) ?? "—"})` : ""}` : "—";
      })
      .join(" · ");

  return (
    <div className="space-y-4">
      {result.proteins.map((p) => (
        <ConservationLoader key={p.accession} accession={p.accession} onState={onState} />
      ))}
      <Section
        title="Conservation de chaque protéine, dans l’alignement commun"
        subtitle="Grades 1 (variable) à 9 (conservé), calculés pour chaque protéine sur ses propres homologues UniRef50, puis placés sur les colonnes communes."
      >
        <ul className="mb-2 flex flex-wrap gap-3 text-[12px] text-slate-600">
          {result.proteins.map((p) => {
            const s = states[p.accession];
            return (
              <li key={p.accession} className="flex items-center gap-1">
                <span className="font-mono">{p.accession}</span> :{" "}
                {s?.result ? `${s.result.sequence_count} séquences` : s?.status === "failed" ? <span className="text-rose-700">échec ({s.error})</span> : <><Loader2 size={11} className="animate-spin" /> calcul en cours</>}
              </li>
            );
          })}
        </ul>
        <Tracks result={result} items={items} column={column} onColumn={onColumn} />
      </Section>
      {table && (
        <div className="grid gap-4 xl:grid-cols-2">
          <PositionList title={`Conservées dans toutes les protéines (${table.shared.length})`} text="Grade ≥ 8 partout : contraintes communes, souvent structurales ou fonctionnelles partagées." positions={table.shared} describe={describe} onColumn={onColumn} />
          <PositionList title={`Conservation divergente (${table.divergent.length})`} text="Conservée (grade ≥ 8) dans une protéine, variable (≤ 4) dans une autre : candidates pour une spécialisation fonctionnelle." positions={table.divergent} describe={describe} onColumn={onColumn} />
        </div>
      )}
      <p className="flex items-start gap-1.5 text-[12px] text-slate-500">
        <Info size={13} className="mt-0.5 shrink-0" />
        Les grades sont relatifs à chaque protéine (rang dans sa propre séquence) : comparez des positions conservées ou variables, pas
        les valeurs exactes. Seules les colonnes de la référence sont prises en compte (pas les insertions).
      </p>
    </div>
  );
}

function PositionList({ title, text, positions, describe, onColumn }: { title: string; text: string; positions: number[]; describe: (k: number) => string; onColumn: (k: number) => void }) {
  return (
    <Section title={title} subtitle={text}>
      <ul className="max-h-72 space-y-0.5 overflow-auto text-[13px]">
        {positions.map((k) => (
          <li key={k}>
            <button onClick={() => onColumn(k)} className="w-full rounded px-1 text-left font-mono hover:bg-slate-50">
              <span className="text-slate-400">col. {k + 1}</span> {describe(k)}
            </button>
          </li>
        ))}
        {positions.length === 0 && <li className="text-slate-500">Aucune.</li>}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Propriétés physico-chimiques
// ---------------------------------------------------------------------------

const PROPERTY_ROWS: { key: keyof ComparisonResult["proteins"][number]["properties"]; label: string; format: (v: number) => string; help?: string }[] = [
  { key: "length", label: "Longueur", format: (v) => `${v}` },
  { key: "molecular_weight", label: "Masse moléculaire", format: (v) => `${(v / 1000).toFixed(1)} kDa` },
  { key: "isoelectric_point", label: "Point isoélectrique (pI)", format: (v) => v.toFixed(2) },
  { key: "net_charge_ph7", label: "Charge nette à pH 7", format: (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)) },
  { key: "gravy", label: "Hydropathie moyenne (GRAVY)", format: (v) => v.toFixed(2), help: "> 0 : hydrophobe (protéines membranaires)" },
  { key: "aliphatic_index", label: "Indice aliphatique", format: (v) => v.toFixed(0), help: "stabilité thermique relative" },
  { key: "hydrophobic_fraction", label: "Résidus hydrophobes", format: (v) => pct(v) },
  { key: "charged_fraction", label: "Résidus chargés", format: (v) => pct(v) },
  { key: "aromatic_fraction", label: "Résidus aromatiques", format: (v) => pct(v) },
  { key: "cysteines", label: "Cystéines", format: (v) => `${v}` },
];

export function PropertiesTab({ result, column, onColumn }: ColumnProps) {
  const proteins = result.proteins;
  return (
    <div className="space-y-4">
      <Section title="Propriétés calculées sur la séquence" subtitle="ExPASy ProtParam (masses, indice aliphatique), pKa d’EMBOSS, Kyte-Doolittle. Séquence complète, sans modification post-traductionnelle.">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="px-2 py-1 font-semibold">Propriété</th>
                {proteins.map((_, p) => (
                  <th key={p} className="px-2 py-1 text-right font-normal">
                    <ProteinLabel result={result} p={p} short />
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-semibold">Écart</th>
              </tr>
            </thead>
            <tbody>
              {PROPERTY_ROWS.map((row) => {
                const values = proteins.map((p) => p.properties[row.key] as number | null);
                const finite = values.filter((v): v is number => v != null);
                const spread = finite.length ? Math.max(...finite) - Math.min(...finite) : null;
                return (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="px-2 py-1">
                      {row.label}
                      {row.help && <span className="ml-1 text-[11px] text-slate-400">{row.help}</span>}
                    </td>
                    {values.map((v, p) => (
                      <td key={p} className={`px-2 py-1 text-right tabular-nums ${v != null && finite.length > 1 && (v === Math.max(...finite) || v === Math.min(...finite)) && spread ? "font-semibold" : ""}`}>
                        {v == null ? "—" : row.format(v)}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">{spread == null ? "—" : row.format(spread).replace("+", "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <HydropathyProfiles result={result} column={column} onColumn={onColumn} />

      <Section title="Composition en acides aminés (%)" subtitle="Teinte : écart à la moyenne des protéines comparées pour chaque acide aminé.">
        <div className="overflow-x-auto">
          <table className="text-[12px]">
            <thead>
              <tr>
                <th />
                {Object.keys(proteins[0].properties.composition).map((a) => (
                  <th key={a} className="w-9 px-0.5 text-center font-mono">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {proteins.map((protein, p) => (
                <tr key={p}>
                  <th className="pr-2 text-left font-normal">
                    <ProteinLabel result={result} p={p} short />
                  </th>
                  {Object.entries(protein.properties.composition).map(([a, v]) => {
                    const mean = proteins.reduce((s, x) => s + x.properties.composition[a], 0) / proteins.length;
                    const delta = v - mean;
                    const color = delta > 0 ? `rgba(234, 88, 12, ${Math.min(Math.abs(delta) / 4, 0.8)})` : `rgba(37, 99, 235, ${Math.min(Math.abs(delta) / 4, 0.8)})`;
                    return (
                      <td key={a} className="h-7 w-9 text-center tabular-nums" style={{ backgroundColor: color }} title={`${a} : ${v} % (moyenne ${mean.toFixed(1)} %)`}>
                        {v.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[12px] text-slate-500">Orange : plus que la moyenne ; bleu : moins.</p>
      </Section>
    </div>
  );
}

/** Profils d'hydropathie placés sur les colonnes communes (comparaison position par position). */
function HydropathyProfiles({ result, column, onColumn }: ColumnProps) {
  const W = 1000;
  const H = 220;
  const L = 34;
  const total = result.alignment.columns.length;
  const x = (c: number) => L + (c / Math.max(total - 1, 1)) * (W - L - 8);
  const lo = -3;
  const hi = 3.5;
  const y = (v: number) => 8 + ((hi - Math.max(lo, Math.min(hi, v))) / (hi - lo)) * (H - 30);
  const paths = result.proteins.map((protein, p) => {
    const segments: string[] = [];
    let current: string[] = [];
    result.alignment.columns.forEach((c, k) => {
      const r = c[p];
      const v = r ? protein.properties.hydropathy_profile[r - 1] : null;
      if (v == null) {
        if (current.length > 1) segments.push(current.join(" "));
        current = [];
      } else current.push(`${x(k)},${y(v)}`);
    });
    if (current.length > 1) segments.push(current.join(" "));
    return segments;
  });
  return (
    <Section title="Profils d’hydropathie alignés" subtitle="Kyte-Doolittle, fenêtre de 9 résidus. Au-dessus de 1,6 (ligne) : segment hydrophobe, typiquement transmembranaire. Interruptions : résidus absents (gaps).">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        role="img"
        aria-label="Profils d’hydropathie alignés"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const c = Math.round((((e.clientX - rect.left) / rect.width) * W - L) / ((W - L - 8) / Math.max(total - 1, 1)));
          if (c >= 0 && c < total) onColumn(c);
        }}
      >
        {[-2, 0, 1.6, 3].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} stroke={v === 1.6 ? "#d97706" : "#eef2f6"} strokeDasharray={v === 1.6 ? "4 3" : undefined} />
            <text x={L - 4} y={y(v) + 4} fontSize={10} fill="#64748b" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {paths.map((segments, p) => segments.map((points, k) => <polyline key={`${p}-${k}`} points={points} fill="none" stroke={proteinColor(p)} strokeWidth={1.5} />))}
        {column != null && <line x1={x(column)} x2={x(column)} y1={4} y2={H - 22} stroke="#7c3aed" strokeWidth={1.5} />}
        <text x={L} y={H - 4} fontSize={10} fill="#64748b">
          colonne 1
        </text>
        <text x={W - 8} y={H - 4} fontSize={10} fill="#64748b" textAnchor="end">
          {total}
        </text>
      </svg>
      <div className="flex flex-wrap gap-3 text-[12px] text-slate-600">
        {result.proteins.map((p, k) => (
          <span key={p.accession} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ backgroundColor: proteinColor(k) }} />
            {p.accession}
          </span>
        ))}
      </div>
    </Section>
  );
}

