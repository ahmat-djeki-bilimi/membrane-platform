"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, GitCompare, Info, Loader2 } from "lucide-react";
import SuperpositionViewer from "./SuperpositionViewer";
import { API_BASE } from "@/lib/api";
import { readJob } from "@/lib/jobs";
import {
  DEVIATION_BANDS,
  deviationColor,
  plddtColor,
  type ComparisonResult,
  type PredictionResult,
} from "@/lib/prediction";

export type ExperimentalEntry = {
  pdb_id: string;
  method?: string;
  resolution?: number | null;
  coverage_percent?: number | null;
};

type Range = { start: number; end: number; label: string; color?: string };

export type ModelSource = "esmfold" | "alphafold";

const MODEL_NAMES: Record<ModelSource, string> = { esmfold: "ESMFold", alphafold: "AlphaFold" };

const fmt = (v?: number | null, d = 1) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Superposition d'un modèle (ESMFold ou AlphaFold, placé dans la membrane)
 * et d'une structure expérimentale : où le modèle est fidèle, où il s'écarte,
 * et ce que l'expérience apporte en plus (ligands, mutations).
 */
export default function ComparisonPanel({
  accession,
  esmfold,
  alphafoldAvailable,
  models = ["esmfold", "alphafold"],
  entries,
  defaultPdbId,
  fileBase,
}: {
  accession: string;
  /** Prédiction ESMFold terminée ; nulle tant qu'elle est en cours. */
  esmfold: { jobId: string; result: PredictionResult } | null;
  alphafoldAvailable: boolean;
  /** Modèles proposés dans le sélecteur. */
  models?: ModelSource[];
  entries: ExperimentalEntry[];
  defaultPdbId?: string | null;
  fileBase: string;
}) {
  const [pdbId, setPdbId] = useState(() => (defaultPdbId || entries[0]?.pdb_id || "").toUpperCase());
  const [source, setSource] = useState<ModelSource>(esmfold || !alphafoldAvailable ? "esmfold" : "alphafold");
  const [state, setState] = useState<{
    loading: boolean;
    model: PredictionResult | null;
    result: ComparisonResult | null;
    error: string | null;
  }>({ loading: false, model: null, result: null, error: null });
  const [focus, setFocus] = useState<Range | null>(null);
  const jobId = esmfold?.jobId;
  const esmfoldResult = esmfold?.result;

  useEffect(() => {
    if (!pdbId || (source === "esmfold" && !jobId)) return;
    let cancelled = false;
    setState({ loading: true, model: null, result: null, error: null });
    setFocus(null);
    const request =
      source === "esmfold"
        ? fetch(`${API_BASE}/api/predicted-structure/jobs/${jobId}/compare/${pdbId.toLowerCase()}?accession=${accession}`)
            .then(readJob)
            .then((result: ComparisonResult) => ({ model: esmfoldResult!, result }))
        : fetch(`${API_BASE}/api/alphafold/${accession}/compare/${pdbId.toLowerCase()}`)
            .then(readJob)
            .then((data: { model: PredictionResult; comparison: ComparisonResult }) => ({ model: data.model, result: data.comparison }));
    request
      .then(({ model, result }) => !cancelled && setState({ loading: false, model, result, error: null }))
      .catch(
        (e) => !cancelled && setState({ loading: false, model: null, result: null, error: e.message || "Comparaison impossible." })
      );
    return () => {
      cancelled = true;
    };
  }, [source, jobId, esmfoldResult, accession, pdbId]);

  const modelName = MODEL_NAMES[source];
  const prediction = state.model;

  const toggle = (range: Range) =>
    setFocus((current) => (current?.start === range.start && current?.end === range.end ? null : range));

  const c = state.result;

  return (
    <section id="superposition" className="scroll-mt-16 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md bg-violet-600 p-2 text-white shadow-sm">
            <GitCompare size={16} />
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-violet-700">Modèle et expérience</p>
            <h2 className="text-[17px] font-semibold text-slate-900">
              {models.length === 1 ? `Superposition ${modelName} / structure expérimentale` : "Superposition avec une structure expérimentale"}
            </h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        {models.length > 1 && (
        <div className="flex items-center gap-2 text-[14px] text-slate-700">
          Modèle comparé
          <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-[13px]" role="radiogroup" aria-label="Modèle comparé">
            {models.map((key) => {
              const enabled = key === "esmfold" ? !!esmfold : alphafoldAvailable;
              return (
                <button
                  key={key}
                  role="radio"
                  aria-checked={source === key}
                  disabled={!enabled}
                  title={key === "esmfold" && !esmfold ? "Prédiction ESMFold en cours" : key === "alphafold" && !alphafoldAvailable ? "Pas de modèle AlphaFold pour cette entrée" : undefined}
                  onClick={() => setSource(key)}
                  className={`rounded px-2.5 py-1 font-semibold disabled:opacity-40 ${
                    source === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {MODEL_NAMES[key]}
                </button>
              );
            })}
          </div>
        </div>
        )}
        <label className="flex items-center gap-2 text-[14px] text-slate-700">
          Structure PDB
          <select
            value={pdbId}
            onChange={(e) => setPdbId(e.target.value)}
            className="max-w-[320px] rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[13px] text-slate-900"
          >
            {entries.map((e) => (
              <option key={e.pdb_id} value={e.pdb_id.toUpperCase()}>
                {e.pdb_id.toUpperCase()}
                {e.method ? ` · ${e.method}` : ""}
                {e.resolution ? ` · ${fmt(e.resolution, 2)} Å` : ""}
                {e.coverage_percent != null ? ` · ${Math.round(e.coverage_percent)} %` : ""}
              </option>
            ))}
          </select>
        </label>
        </div>
      </div>

      {source === "esmfold" && !esmfold && (
        <p className="flex items-center gap-2 py-2 text-[14px] text-slate-600">
          <Loader2 size={16} className="animate-spin text-cyan-600" />
          En attente de la prédiction ESMFold…{alphafoldAvailable ? " Le modèle AlphaFold peut déjà être comparé." : ""}
        </p>
      )}

      {state.loading && (
        <p className="flex items-center gap-2 py-4 text-[14px] text-slate-600">
          <Loader2 size={16} className="animate-spin text-violet-600" />
          {source === "alphafold" ? "Placement du modèle AlphaFold dans la membrane, " : "Téléchargement de "}
          {pdbId}, correspondance des résidus et superposition…
        </p>
      )}
      {state.error && (
        <p className="flex items-start gap-2 text-[14px] text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}

      {c && prediction && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="TM-score"
              value={fmt(c.tm_score, 2)}
              hint={c.tm_score >= 0.8 ? "repliement quasi identique" : c.tm_score >= 0.5 ? "même repliement" : "repliements différents"}
            />
            <Stat label="RMSD Cα" value={`${fmt(c.rmsd_all, 2)} Å`} hint={`sur les ${c.pairs} résidus communs`} />
            <Stat
              label="Résidus à moins de 2 Å"
              value={`${Math.round(c.fraction_close * 100)} %`}
              hint={c.rmsd_close != null ? `RMSD ${fmt(c.rmsd_close, 2)} Å sur ces résidus` : "—"}
            />
            <Stat
              label="Résidus comparés"
              value={`${c.pairs} / ${c.modelled}`}
              hint={`${Math.round(c.coverage * 100)} % du modèle observés dans le cristal`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <div>
              <SuperpositionViewer
                modelPdb={prediction.pdb}
                modelName={modelName}
                comparison={c}
                fileBase={`${fileBase}_${source}`}
                activeRange={focus}
              />
              <p className="mt-1.5 text-[13px] text-slate-500">
                Structure expérimentale superposée sur le cœur du modèle {modelName} (TM-score maximal), puis montrée
                dans la membrane placée sur le modèle.
                {source === "alphafold" &&
                  " AlphaFold a été entraîné sur les structures du PDB : un accord très élevé est attendu pour une protéine déjà cristallisée."}
              </p>
              <CrystalContents comparison={c} />
            </div>
            <Notes notes={c.interpretation} />
          </div>

          <DeviationProfile comparison={c} prediction={prediction} modelName={modelName} focus={focus} onSelect={toggle} />

          <div className="grid gap-4 xl:grid-cols-2">
            <RegionTable comparison={c} focus={focus} onSelect={toggle} />
            <HelixTiltTable comparison={c} prediction={prediction} focus={focus} onSelect={toggle} />
          </div>

          {(c.ligands.length > 0 || c.mutations.length > 0) && (
            <div className="grid gap-4 xl:grid-cols-2">
              {c.ligands.length > 0 && <LigandSites comparison={c} focus={focus} onSelect={toggle} />}
              {c.mutations.length > 0 && (
                <div>
                  <h3 className="text-[16px] font-semibold text-slate-900">Différences de séquence ({c.mutations.length})</h3>
                  <p className="mb-2 text-[13px] text-slate-500">Résidu du modèle, position, résidu de la construction cristallisée.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {c.mutations.map((m) => (
                      <button
                        key={m.number}
                        onClick={() => toggle({ start: m.number, end: m.number, label: `${m.model}${m.number}${m.experimental}` })}
                        className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[13px] font-semibold text-slate-800 hover:bg-slate-200"
                      >
                        {m.model}
                        {m.number}
                        {m.experimental}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-[13px] leading-5 text-slate-500">Méthode : {c.method}.</p>
        </>
      )}
    </section>
  );
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

/** Chaînes du cristal : celle comparée au modèle, et le reste (partenaires, protéine fusionnée). */
const COLLAPSED_CHAINS = 6;

function CrystalContents({ comparison }: { comparison: ComparisonResult }) {
  const [showAll, setShowAll] = useState(false);
  if (!comparison.other_chains.length) return null;
  const chains = showAll ? comparison.other_chains : comparison.other_chains.slice(0, COLLAPSED_CHAINS);
  const hidden = comparison.other_chains.length - chains.length;
  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
      <p className="mb-1 font-semibold text-slate-900">
        Contenu du cristal {comparison.pdb_id} · {comparison.other_chains.length + 1} chaînes
        {comparison.file_format === "mmCIF" && <span className="ml-1 font-normal text-slate-500">(fichier mmCIF)</span>}
      </p>
      {comparison.others_simplified && (
        <p className="mb-1 text-slate-500">
          Grand complexe : les autres chaînes sont montrées par leur chaîne principale seule, pour garder la vue fluide.
        </p>
      )}
      <ul className="max-h-[260px] space-y-0.5 overflow-auto">
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#c026d3]" />
          <span className="font-mono font-semibold">{comparison.chain}</span>
          <span>{comparison.molecule ? sentenceCase(comparison.molecule) : "Chaîne comparée"}</span>
          <span className="text-slate-400">· comparée au modèle</span>
        </li>
        {chains.map((o) => (
          <li key={`${o.chain}-${o.fused}`} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: o.fused ? "#f0abfc" : "#94a3b8" }} />
            <span className="font-mono font-semibold">{o.chain}</span>
            <span>{o.molecule ? sentenceCase(o.molecule) : "Molécule non nommée"}</span>
            <span className="text-slate-400">· {o.residues} résidus</span>
          </li>
        ))}
      </ul>
      {(hidden > 0 || showAll) && comparison.other_chains.length > COLLAPSED_CHAINS && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-1 font-semibold text-violet-700 hover:underline">
          {showAll ? "Afficher moins" : `Afficher les ${hidden} autres chaînes`}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="text-[22px] font-bold text-slate-900">{value}</p>
      <p className="truncate text-[13px] text-slate-500" title={hint}>
        {hint}
      </p>
    </div>
  );
}

const NOTE_STYLE = {
  good: { icon: <CheckCircle2 size={16} />, className: "border-emerald-200 bg-emerald-50", iconClass: "text-emerald-600" },
  warning: { icon: <AlertTriangle size={16} />, className: "border-amber-200 bg-amber-50", iconClass: "text-amber-600" },
  info: { icon: <Info size={16} />, className: "border-slate-200 bg-slate-50", iconClass: "text-slate-500" },
} as const;

function Notes({ notes }: { notes: ComparisonResult["interpretation"] }) {
  return (
    <div>
      <h3 className="text-[16px] font-semibold text-slate-900">Ce que montre la superposition</h3>
      <p className="mb-3 text-[13px] text-slate-500">Lecture automatique des écarts, par règles explicites.</p>
      <ul className="max-h-[540px] space-y-2 overflow-auto pr-1">
        {notes.map((note, i) => {
          const style = NOTE_STYLE[note.level] ?? NOTE_STYLE.info;
          return (
            <li key={`${i}-${note.title}`} className={`flex gap-2.5 rounded-md border px-3 py-2 ${style.className}`}>
              <span className={`mt-0.5 shrink-0 ${style.iconClass}`}>{style.icon}</span>
              <div>
                <p className="text-[14px] font-semibold text-slate-900">{note.title}</p>
                <p className="text-[14px] leading-5 text-slate-700">{note.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profil d'écart résidu par résidu
// ---------------------------------------------------------------------------

const W = 1000;
const LEFT = 36;
const RIGHT = 8;
const TOP = 8;
const PLOT_H = 120;
const MAX_D = 8; // Å : au-delà, la barre est plafonnée
const STRIP_Y = TOP + PLOT_H + 8;
const STRIP_H = 10;
const H = STRIP_Y + STRIP_H + 22;

function DeviationProfile({
  comparison,
  prediction,
  modelName,
  focus,
  onSelect,
}: {
  comparison: ComparisonResult;
  prediction: PredictionResult;
  modelName: string;
  focus: Range | null;
  onSelect: (range: Range) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { start, end } = prediction.window;
  const span = end - start + 1;
  const step = (W - LEFT - RIGHT) / span;
  const x = (n: number) => LEFT + (n - start) * step;
  const y = (d: number) => TOP + PLOT_H - (Math.min(d, MAX_D) / MAX_D) * PLOT_H;
  const byNumber = useMemo(() => new Map(comparison.residues.map((r) => [r.number, r])), [comparison]);
  const plddt = useMemo(() => new Map(prediction.residues.map((r) => [r.number, r.plddt])), [prediction]);
  const helices = prediction.helices ?? [];
  const hovered = hover != null ? byNumber.get(hover) : null;
  const hoveredHelix = hover != null ? helices.find((h) => hover >= h.helix_start && hover <= h.helix_end) : null;

  const ticks = useMemo(() => {
    const every = span > 300 ? 50 : span > 120 ? 25 : 10;
    const out = [];
    for (let n = Math.ceil(start / every) * every; n <= end; n += every) out.push(n);
    return out;
  }, [start, end, span]);

  return (
    <div>
      <h3 className="text-[16px] font-semibold text-slate-900">Écart au cristal, résidu par résidu</h3>
      <p className="mb-2 text-[13px] text-slate-500">
        Distance entre les Cα du modèle {modelName} et du cristal après superposition ; bande du bas : pLDDT du modèle. Zones
        orangées : hélices transmembranaires. Cliquez une barre pour voir le résidu en 3D.
      </p>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)} role="img" aria-label="Écart entre modèle et cristal par résidu">
          {helices.map((h) => (
            <rect
              key={h.label}
              x={x(Math.max(h.helix_start, start))}
              y={TOP}
              width={(Math.min(h.helix_end, end) - Math.max(h.helix_start, start) + 1) * step}
              height={PLOT_H}
              fill="#fde68a"
              opacity={0.35}
            />
          ))}
          {[0, 2, 4, 6, 8].map((d) => (
            <g key={d}>
              <line x1={LEFT} x2={W - RIGHT} y1={y(d)} y2={y(d)} stroke={d === 0 ? "#94a3b8" : "#e2e8f0"} strokeWidth={1} />
              <text x={LEFT - 6} y={y(d) + 4} textAnchor="end" fontSize={11} fill="#64748b">
                {d === MAX_D ? `≥${d}` : d}
              </text>
            </g>
          ))}
          <text x={4} y={TOP + 10} fontSize={11} fill="#64748b">
            Å
          </text>

          {comparison.residues.map((r) => {
            const active = focus && r.number >= focus.start && r.number <= focus.end;
            return (
              <rect
                key={r.number}
                x={x(r.number) + step * 0.1}
                y={y(r.distance)}
                width={Math.max(step * 0.8, 0.8)}
                height={Math.max(TOP + PLOT_H - y(r.distance), 1)}
                fill={active ? "#7c3aed" : deviationColor(r.distance)}
                rx={Math.min(2, step * 0.3)}
              />
            );
          })}

          {Array.from({ length: span }, (_, i) => start + i).map((n) => {
            const score = plddt.get(n);
            return score == null ? null : (
              <rect key={n} x={x(n)} y={STRIP_Y} width={step + 0.3} height={STRIP_H} fill={plddtColor(score)} />
            );
          })}
          <text x={LEFT - 6} y={STRIP_Y + 9} textAnchor="end" fontSize={10} fill="#64748b">
            pLDDT
          </text>
          {ticks.map((n) => (
            <text key={n} x={x(n) + step / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="#64748b">
              {n}
            </text>
          ))}

          {hover != null && <line x1={x(hover) + step / 2} x2={x(hover) + step / 2} y1={TOP} y2={STRIP_Y + STRIP_H} stroke="#0f172a" strokeWidth={1} opacity={0.4} />}

          {/* Zones de survol plus larges que les barres */}
          {Array.from({ length: span }, (_, i) => start + i).map((n) => (
            <rect
              key={`hit-${n}`}
              x={x(n)}
              y={TOP}
              width={step}
              height={STRIP_Y + STRIP_H - TOP}
              fill="transparent"
              onMouseEnter={() => setHover(n)}
              onClick={() => byNumber.has(n) && onSelect({ start: n, end: n, label: `Résidu ${n}` })}
              className={byNumber.has(n) ? "cursor-pointer" : ""}
            />
          ))}
        </svg>
        {hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md bg-slate-900 px-2.5 py-1.5 text-[12px] text-white shadow-lg"
            style={{ left: `${Math.min(80, Math.max(2, ((x(hover) + step / 2) / W) * 100))}%` }}
          >
            <p className="font-semibold">
              {hovered ? `${hovered.aa}${hover}` : `Résidu ${hover}`}
              {hoveredHelix ? ` · ${hoveredHelix.label}` : ""}
            </p>
            <p>{hovered ? `Écart ${fmt(hovered.distance, 1)} Å` : "Non observé dans le cristal"}</p>
            <p>pLDDT {fmt(plddt.get(hover), 0)}</p>
            {hovered && hovered.aa !== hovered.aa_experimental && <p>Cristal : {hovered.aa_experimental}</p>}
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
        <span className="font-medium text-slate-700">Écart :</span>
        {DEVIATION_BANDS.map((b) => (
          <span key={b.label} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
            {b.label}
          </span>
        ))}
        <span className="ml-auto text-slate-400">Résidus absents du cristal : pas de barre</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tableaux
// ---------------------------------------------------------------------------

function RegionTable({
  comparison,
  focus,
  onSelect,
}: {
  comparison: ComparisonResult;
  focus: Range | null;
  onSelect: (range: Range) => void;
}) {
  if (!comparison.regions.length) return null;
  return (
    <div>
      <h3 className="text-[16px] font-semibold text-slate-900">Écart par région</h3>
      <p className="mb-2 text-[13px] text-slate-500">Hélices, boucles et extrémités du modèle ; cliquez une ligne pour la voir en 3D.</p>
      <div className="max-h-[360px] overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-[14px]">
          <thead className="sticky top-0 bg-slate-50 text-[13px] text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Région</th>
              <th className="px-3 py-2 text-left font-semibold">Résidus</th>
              <th className="px-3 py-2 text-right font-semibold">Écart moyen</th>
              <th className="px-3 py-2 text-right font-semibold">Max</th>
              <th className="px-3 py-2 text-right font-semibold">pLDDT</th>
            </tr>
          </thead>
          <tbody>
            {comparison.regions.map((r) => {
              const active = focus?.start === r.start && focus?.end === r.end;
              return (
                <tr
                  key={r.start}
                  onClick={() => onSelect({ start: r.start, end: r.end, label: r.label })}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${active ? "bg-violet-50" : ""}`}
                >
                  <td className="px-3 py-1.5 text-slate-800">{r.label}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-700">
                    {r.start}–{r.end}
                    {r.observed < r.length && (
                      <span className="ml-1 text-[12px] text-slate-400" title="Résidus observés dans le cristal">
                        ({r.observed}/{r.length})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: deviationColor(r.mean_distance) }} />
                      {fmt(r.mean_distance)} Å
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">{fmt(r.max_distance)} Å</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">{fmt(r.mean_plddt, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HelixTiltTable({
  comparison,
  prediction,
  focus,
  onSelect,
}: {
  comparison: ComparisonResult;
  prediction: PredictionResult;
  focus: Range | null;
  onSelect: (range: Range) => void;
}) {
  if (!comparison.helices.length) return null;
  const spans = new Map((prediction.helices ?? []).map((h) => [h.label, h]));
  return (
    <div>
      <h3 className="text-[16px] font-semibold text-slate-900">Inclinaison des hélices</h3>
      <p className="mb-2 text-[13px] text-slate-500">Angle avec la normale à la membrane, dans le modèle et dans le cristal superposé.</p>
      <div className="overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-[14px]">
          <thead className="bg-slate-50 text-[13px] text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Hélice</th>
              <th className="px-3 py-2 text-right font-semibold">Modèle</th>
              <th className="px-3 py-2 text-right font-semibold">Cristal</th>
              <th className="px-3 py-2 text-right font-semibold">Différence</th>
              <th className="px-3 py-2 text-right font-semibold">RMSD</th>
            </tr>
          </thead>
          <tbody>
            {comparison.helices.map((h) => {
              const helix = spans.get(h.label);
              const range = helix ? { start: helix.helix_start, end: helix.helix_end, label: h.label } : null;
              const active = range && focus?.start === range.start && focus?.end === range.end;
              return (
                <tr
                  key={h.label}
                  onClick={() => range && onSelect(range)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${active ? "bg-violet-50" : ""}`}
                >
                  <td className="px-3 py-1.5 font-semibold text-slate-900">{h.label}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(h.tilt_model, 0)}°</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(h.tilt_experimental, 0)}°</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${h.tilt_difference >= 10 ? "font-semibold text-amber-700" : "text-slate-700"}`}>
                    {fmt(h.tilt_difference, 0)}°
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">{fmt(h.rmsd, 2)} Å</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LigandSites({
  comparison,
  focus,
  onSelect,
}: {
  comparison: ComparisonResult;
  focus: Range | null;
  onSelect: (range: Range) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? comparison.ligands : comparison.ligands.slice(0, 4);
  return (
    <div>
      <h3 className="text-[16px] font-semibold text-slate-900">Ligands du cristal reportés sur le modèle</h3>
      <p className="mb-2 text-[13px] text-slate-500">
        Résidus du modèle à moins de 4,5 Å de chaque ligand expérimental, après superposition.
      </p>
      <ul className="space-y-2">
        {shown.map((site) => (
          <li key={`${site.ligand}-${site.number}`} className="rounded-md border border-slate-200 px-3 py-2">
            <p className="text-[14px] font-semibold text-slate-900">
              {site.ligand} {site.number}
              <span className="ml-2 text-[13px] font-normal text-slate-500">
                {site.residues.length} résidus · pLDDT moyen {fmt(site.mean_plddt, 0)}
              </span>
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {site.residues.map((r) => {
                const active = focus?.start === r.number && focus?.end === r.number;
                return (
                  <button
                    key={r.number}
                    onClick={() => onSelect({ start: r.number, end: r.number, label: `${r.aa}${r.number}`, color: "#16a34a" })}
                    className={`rounded px-1.5 py-0.5 font-mono text-[12px] font-semibold ${
                      active ? "bg-violet-600 text-white" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
                    }`}
                  >
                    {r.aa}
                    {r.number}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {comparison.ligands.length > 4 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-[13px] font-semibold text-violet-700 hover:underline">
          {showAll ? "Afficher moins" : `Afficher les ${comparison.ligands.length} ligands (lipides, détergents…)`}
        </button>
      )}
    </div>
  );
}
