"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Play } from "lucide-react";
import {
  EMPTY_FORM,
  SUGGESTED_FORM,
  checkMapping,
  formFromParams,
  mappingCsv,
  paramsFromForm,
  previewQuality,
  sameForm,
  type QualityForm,
} from "@/lib/alignmentQc";
import type { ExplorerResult, QualityParams } from "@/lib/explorer";
import { downloadText } from "@/lib/sequence";

const W = 1000;
const LEFT = 34;
const RIGHT = 8;
const STRIP_H = 70;
const MARK_H = 8;

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`);

/**
 * Contrôle qualité de l'alignement multiple : gaps par colonne, couverture des
 * séquences, diversité et régions mal alignées. Les filtres écartent des
 * séquences incomplètes et masquent des colonnes sans jamais décaler la
 * numérotation : la colonne k reste le résidu k de la référence.
 */
export default function AlignmentQuality({
  result,
  applied,
  selected,
  onSelect,
  onApply,
  fileBase,
}: {
  result: ExplorerResult;
  /** Réglages de l'analyse affichée. */
  applied?: QualityParams | null;
  selected: number | null;
  onSelect: (position: number) => void;
  onApply?: (params: QualityParams | null) => Promise<void>;
  fileBase: string;
}) {
  const quality = result.qc;
  const initial = useMemo(() => formFromParams(applied ?? quality?.params), [applied, quality]);
  const [form, setForm] = useState<QualityForm>(initial);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapping = useMemo(() => checkMapping(result), [result]);
  const preview = useMemo(() => (quality ? previewQuality(result, quality, form) : null), [result, quality, form]);

  if (!quality || !preview) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Contrôle qualité de l’alignement</h3>
        <p className="mt-1 text-[14px] text-slate-600">
          Cette analyse a été calculée avant l’ajout du contrôle qualité : recalculez-la (bandeau en haut de la page) pour
          voir les gaps par colonne, la couverture des séquences et les régions mal alignées.
        </p>
      </section>
    );
  }

  const s = quality.summary;
  const d = quality.diversity;
  const changed = !sameForm(form, initial);
  const tooStrict = preview.kept.length === 0 || preview.maskedCount > 0.8 * result.query_sequence.length;

  const apply = async () => {
    if (!onApply) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(paramsFromForm(form));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setApplying(false);
    }
  };
  const set = (patch: Partial<QualityForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div>
          <h3 className="text-[16px] font-semibold text-slate-900">Contrôle qualité de l’alignement</h3>
          <p className="text-[13px] text-slate-500">
            À vérifier avant de lire la conservation et la coévolution. Les filtres s’appliquent en relançant le calcul.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mapping.exact && quality.mapping.exact ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-[13px] font-semibold text-emerald-800" title="Les insertions des homologues sont retirées ; une colonne masquée garde son numéro">
              <CheckCircle2 size={14} />
              Correspondance exacte : colonne k = résidu k de la référence ({quality.mapping.columns} positions)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-[13px] font-semibold text-rose-800">
              <AlertTriangle size={14} />
              Correspondance à vérifier : {mapping.problems.join(", ")}
            </span>
          )}
          <button
            onClick={() => downloadText(`${fileBase}_colonnes_residus.csv`, mappingCsv(result, quality))}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download size={13} />
            Colonnes ↔ résidus (CSV)
          </button>
        </div>
      </div>

      <dl className="grid gap-2 p-4 text-[13px] sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Séquences gardées" value={`${s.kept} / ${s.sequences}`} hint={s.removed ? `${s.removed} incomplète(s) écartée(s)` : "aucune écartée"} />
        <Tile label="Couverture médiane" value={pct(s.median_coverage)} hint="de la référence par homologue" />
        <Tile label="Gaps moyens" value={pct(s.mean_gap)} hint={`${s.high_gap_columns} colonne(s) à plus de 50 %`} />
        <Tile
          label="Identité entre homologues"
          value={pct(d.mean_pairwise_identity)}
          hint={`médiane avec la référence : ${pct(d.median_identity_to_reference)}`}
          title={d.sampled < s.kept ? `Moyenne sur ${d.sampled} séquences réparties dans l’alignement` : undefined}
        />
        <Tile
          label="Neff (80 %)"
          value={d.neff.toLocaleString("fr-FR")}
          hint={`${d.neff_per_length.toLocaleString("fr-FR")} par position${d.neff_per_length < 1 ? " : peu pour la coévolution" : ""}`}
          title="Nombre effectif de séquences : les séquences à ≥ 80 % d’identité comptent ensemble pour une"
        />
        <Tile
          label="Colonnes masquées"
          value={`${s.masked_columns}`}
          hint={`${quality.poor_regions.length} région(s) mal alignée(s) (${s.poor_region_positions} positions)`}
        />
      </dl>

      <div className="px-4">
        <ColumnProfiles result={result} preview={preview} form={form} selected={selected} onSelect={onSelect} />
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div>
          <p className="text-[13px] font-semibold text-slate-700">Couverture des séquences</p>
          <CoverageHistogram coverages={quality.sequences.map((q) => q.coverage)} threshold={form.minCoverage} />
          <p className="mt-2 text-[13px] font-semibold text-slate-700">Régions mal alignées</p>
          {quality.poor_regions.length === 0 ? (
            <p className="text-[13px] text-slate-500">Aucune : les colonnes sont bien couvertes et les résidus alignés ressemblent à ceux de la référence.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {quality.poor_regions.map((r) => (
                <li key={r.start}>
                  <button
                    onClick={() => onSelect(r.start)}
                    className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-[13px] hover:bg-amber-50"
                  >
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
                    <span>
                      <b className="font-mono">
                        {r.start}–{r.end}
                      </b>{" "}
                      ({result.query_sequence.slice(r.start - 1, Math.min(r.end, r.start + 11))}
                      {r.end - r.start >= 12 ? "…" : ""}) · {r.reason} · gaps {pct(r.mean_gap)}, similarité {pct(r.mean_similarity)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-slate-200 p-3">
          <p className="text-[13px] font-semibold text-slate-700">Filtres avant le calcul</p>
          <div className="mt-2 space-y-2 text-[13px] text-slate-700">
            <NumberRow label="Écarter les séquences couvrant moins de" value={form.minCoverage} suffix="% de la référence" max={100} onChange={(v) => set({ minCoverage: v })} />
            <NumberRow label="Écarter les séquences avec un trou interne de plus de" value={form.maxInternalGap} suffix="positions" onChange={(v) => set({ maxInternalGap: v })} />
            <NumberRow label="Masquer les colonnes à plus de" value={form.maxColumnGaps} suffix="% de gaps" max={100} onChange={(v) => set({ maxColumnGaps: v })} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.maskPoorRegions} onChange={(e) => set({ maskPoorRegions: e.target.checked })} />
              Masquer les régions mal alignées
            </label>
          </div>
          <p className="mt-3 rounded bg-slate-50 px-2 py-1.5 text-[13px] text-slate-700">
            Aperçu : <b>{preview.kept.length}</b> séquence(s) gardée(s), <b>{preview.removed.length}</b> écartée(s),{" "}
            <b>{preview.maskedCount}</b> colonne(s) masquée(s) sur {result.query_sequence.length}. Les colonnes masquées gardent leur
            numéro mais ne comptent ni dans la conservation, ni dans la coévolution, ni dans la SCA.
          </p>
          {tooStrict && (
            <p className="mt-2 text-[13px] text-rose-700">Réglages trop stricts : il faut garder au moins une séquence et 20 % des colonnes.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setForm(SUGGESTED_FORM)} className="rounded-md border border-slate-300 px-2.5 py-1 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Réglages proposés
            </button>
            <button onClick={() => setForm(EMPTY_FORM)} className="rounded-md border border-slate-300 px-2.5 py-1 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Aucun filtre
            </button>
            {onApply && (
              <button
                onClick={apply}
                disabled={!changed || tooStrict || applying}
                title={changed ? undefined : "Réglages identiques à ceux de l’analyse affichée"}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#0f4c81] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#0c3d68] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {applying ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Recalculer conservation et coévolution
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-[13px] text-rose-700">Relance impossible : {error}</p>}
          {quality.removed.length > 0 && (
            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer font-semibold text-slate-700">{quality.removed.length} séquence(s) écartée(s) dans l’analyse affichée</summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
                {quality.removed.map((r) => (
                  <li key={r.accession}>
                    <span className="font-mono">{r.accession}</span>
                    {r.organism && <i className="text-slate-500"> {r.organism}</i>} — {r.reasons.join(" ; ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}

function Tile({ label, value, hint, title }: { label: string; value: string; hint: string; title?: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2" title={title}>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-[17px] font-semibold tabular-nums text-slate-900">{value}</dd>
      <dd className="text-[12px] text-slate-500">{hint}</dd>
    </div>
  );
}

function NumberRow({
  label,
  value,
  suffix,
  max,
  onChange,
}: {
  label: string;
  value: number | null;
  suffix: string;
  max?: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex flex-wrap items-center gap-1.5">
      <input type="checkbox" checked={value != null} onChange={(e) => onChange(e.target.checked ? (max ? 50 : 30) : null)} aria-label={`Activer : ${label}`} />
      {label}
      <input
        type="number"
        min={0}
        max={max}
        value={value ?? ""}
        disabled={value == null}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 text-right tabular-nums outline-none focus:border-blue-500 disabled:bg-slate-100"
      />
      {suffix}
    </label>
  );
}

/** Deux profils alignés sur les positions : gaps par colonne, puis similarité avec la référence ; colonnes masquées en dessous. */
function ColumnProfiles({
  result,
  preview,
  form,
  selected,
  onSelect,
}: {
  result: ExplorerResult;
  preview: ReturnType<typeof previewQuality>;
  form: QualityForm;
  selected: number | null;
  onSelect: (position: number) => void;
}) {
  const quality = result.qc!;
  const c = quality.columns;
  const n = c.gap_fraction.length;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const plotW = W - LEFT - RIGHT;
  const barW = plotW / Math.max(n, 1);
  const x = (k: number) => LEFT + k * barW;
  const gapTop = 16;
  const simTop = gapTop + STRIP_H + 22;
  const maskTop = simTop + STRIP_H + 18;
  const H = maskTop + MARK_H * 2 + 14;

  const pick = (clientX: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const k = Math.floor((((clientX - rect.left) / rect.width) * W - LEFT) / barW);
    return k >= 0 && k < n ? k : null;
  };
  const shown = hover ?? (selected ? selected - 1 : null);
  const width = Math.max(barW - (barW > 3 ? 0.5 : 0), 0.6);

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full cursor-crosshair"
        role="img"
        aria-label="Gaps et similarité avec la référence pour chaque position"
        onMouseMove={(e) => setHover(pick(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const k = pick(e.clientX);
          if (k != null) onSelect(k + 1);
        }}
      >
        {/* Régions mal alignées : bande de fond sur les deux profils */}
        {quality.poor_regions.map((r) => (
          <rect key={r.start} x={x(r.start - 1)} y={gapTop} width={(r.end - r.start + 1) * barW} height={simTop + STRIP_H - gapTop} fill="#fef3c7" />
        ))}

        <text x={LEFT} y={gapTop - 5} fontSize={12} fill="#334155" fontWeight={600}>
          Gaps par colonne
        </text>
        <Axis top={gapTop} />
        {c.gap_fraction.map((g, k) => (
          <rect key={k} x={x(k)} y={gapTop + STRIP_H * (1 - g)} width={width} height={STRIP_H * g} fill="#475569" />
        ))}
        {form.maxColumnGaps != null && (
          <g>
            <line x1={LEFT} x2={W - RIGHT} y1={gapTop + STRIP_H * (1 - form.maxColumnGaps / 100)} y2={gapTop + STRIP_H * (1 - form.maxColumnGaps / 100)} stroke="#be123c" strokeDasharray="4 3" />
            <text x={W - RIGHT} y={gapTop + STRIP_H * (1 - form.maxColumnGaps / 100) - 3} fontSize={11} fill="#be123c" textAnchor="end">
              seuil {form.maxColumnGaps} %
            </text>
          </g>
        )}

        <text x={LEFT} y={simTop - 5} fontSize={12} fill="#334155" fontWeight={600}>
          Similarité des résidus alignés avec la référence (BLOSUM62 &gt; 0)
        </text>
        <Axis top={simTop} />
        {c.similarity.map((v, k) => (
          <rect key={k} x={x(k)} y={simTop + STRIP_H * (1 - v)} width={width} height={STRIP_H * v} fill="#0f766e" />
        ))}

        <text x={LEFT - 4} y={maskTop + MARK_H - 1} fontSize={10} fill="#64748b" textAnchor="end">
          actuel
        </text>
        <text x={LEFT - 4} y={maskTop + MARK_H * 2 + 2} fontSize={10} fill="#64748b" textAnchor="end">
          aperçu
        </text>
        <rect x={LEFT} y={maskTop} width={plotW} height={MARK_H} fill="#f1f5f9" />
        <rect x={LEFT} y={maskTop + MARK_H + 3} width={plotW} height={MARK_H} fill="#f1f5f9" />
        {c.masked.map((m, k) => (m ? <rect key={k} x={x(k)} y={maskTop} width={Math.max(barW, 1)} height={MARK_H} fill="#94a3b8" /> : null))}
        {preview.masked.map((m, k) => (m ? <rect key={k} x={x(k)} y={maskTop + MARK_H + 3} width={Math.max(barW, 1)} height={MARK_H} fill="#94a3b8" /> : null))}

        {shown != null && <line x1={x(shown) + barW / 2} x2={x(shown) + barW / 2} y1={gapTop} y2={maskTop + MARK_H * 2 + 3} stroke="#0f172a" />}
        <text x={LEFT} y={H - 1} fontSize={11} fill="#64748b">
          1
        </text>
        <text x={W - RIGHT} y={H - 1} fontSize={11} fill="#64748b" textAnchor="end">
          {n}
        </text>
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> région mal alignée
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm bg-slate-400" /> colonne masquée (analyse affichée / aperçu des réglages)
        </span>
      </div>
      <p className="mt-1 min-h-[22px] text-[13px] text-slate-600" aria-live="polite">
        {shown != null ? (
          <>
            <b className="font-mono text-slate-900">
              {result.query_sequence[shown]}
              {shown + 1}
            </b>{" "}
            · gaps {pct(c.gap_fraction[shown])} · identité avec la référence {pct(c.identity[shown])} · similarité {pct(c.similarity[shown])}
            {c.masked[shown] && <b className="text-slate-800"> · masquée : {c.reasons[shown]}</b>}
            {!c.masked[shown] && preview.masked[shown] && <> · serait masquée avec ces réglages</>}
          </>
        ) : (
          "Survolez les profils pour lire une position ; cliquez pour la suivre dans tous les onglets."
        )}
      </p>
    </div>
  );
}

function Axis({ top }: { top: number }) {
  return (
    <g>
      <line x1={LEFT} x2={W - RIGHT} y1={top + STRIP_H / 2} y2={top + STRIP_H / 2} stroke="#eef2f6" />
      <line x1={LEFT} x2={W - RIGHT} y1={top + STRIP_H} y2={top + STRIP_H} stroke="#94a3b8" />
      <text x={LEFT - 4} y={top + 9} fontSize={10} fill="#64748b" textAnchor="end">
        100
      </text>
      <text x={LEFT - 4} y={top + STRIP_H} fontSize={10} fill="#64748b" textAnchor="end">
        0
      </text>
    </g>
  );
}

/** Nombre de séquences par tranche de couverture ; en gris, celles qu'écarterait le seuil choisi. */
function CoverageHistogram({ coverages, threshold }: { coverages: number[]; threshold: number | null }) {
  const bins = Array.from({ length: 10 }, (_, k) => k / 10);
  const counts = bins.map((lo) => coverages.filter((v) => v >= lo && (lo >= 0.9 ? v <= 1 : v < lo + 0.1)));
  const max = Math.max(...counts.map((c) => c.length), 1);
  return (
    <div className="mt-1">
      <div className="flex h-20 items-end gap-0.5">
        {counts.map((values, k) => {
          const below = threshold == null ? 0 : values.filter((v) => v * 100 < threshold - 1e-9).length;
          return (
            <div key={k} className="flex flex-1 flex-col items-center justify-end" title={`${Math.round(bins[k] * 100)}–${Math.round(bins[k] * 100) + 10} % : ${values.length} séquence(s)${below ? `, ${below} écartée(s)` : ""}`}>
              <span className="text-[10px] text-slate-500">{values.length || ""}</span>
              <div className="flex w-full flex-col overflow-hidden rounded-t" style={{ height: `${(values.length / max) * 60}px` }}>
                <div className="bg-violet-600" style={{ flex: values.length - below }} />
                <div className="bg-slate-300" style={{ flex: below }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-0.5 flex gap-0.5 text-[10px] text-slate-500">
        {bins.map((lo) => (
          <span key={lo} className="flex-1 text-center">
            {Math.round(lo * 100)}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        % de la référence couverte (violet : gardées{threshold != null ? ", gris : écartées par le seuil" : ""})
      </p>
    </div>
  );
}
