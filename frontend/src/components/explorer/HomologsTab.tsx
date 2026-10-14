"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Loader2, Play, RotateCcw } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import type { ExplorerResult } from "@/lib/explorer";
import {
  DEFAULT_FILTERS,
  TAXON_RANKS,
  autoSelection,
  clusterHomologs,
  createIdentityMatrix,
  defaultRank,
  effectiveCount,
  fillIdentityMatrix,
  homologPool,
  nearestIdentity,
  priorityOrder,
  selectionFasta,
  taxonOf,
  type HomologFilters,
  type IdentityMatrix,
} from "@/lib/homologs";
import { downloadText } from "@/lib/sequence";
import HomologDiversity from "./HomologDiversity";

const PAGE = 50;
// Seuils d'identité mutuelle proposés pour regrouper les séquences proches
const THRESHOLDS = [100, 98, 95, 90, 80, 70, 60];
const MIN_RELIABLE = 10;

type SortKey = "identity" | "evalue" | "coverage" | "length" | "redundancy";
type View = "all" | "selected" | "removed";

/** Nombre en notation scientifique lisible (1,2 × 10⁻⁴⁵). */
export function formatEvalue(value: number | null | undefined) {
  if (value == null) return "—";
  if (value === 0) return "0";
  if (value >= 0.01) return value.toLocaleString("fr-FR", { maximumSignificantDigits: 2 });
  const exponent = Math.floor(Math.log10(value));
  const mantissa = value / 10 ** exponent;
  return `${mantissa.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}e${exponent}`;
}

/** P-value : probabilité d'observer au moins un alignement de ce score par hasard. */
const pvalue = (evalue: number | null | undefined) => (evalue == null ? null : -Math.expm1(-evalue));

const pct = (value: number | null | undefined) => (value == null ? "—" : `${Math.round(value * 100)} %`);

/** Identités mutuelles des homologues, calculées par tranches sans bloquer la page. */
function useIdentityMatrix(rows: string[]) {
  const [state, setState] = useState<{ rows: string[]; matrix: IdentityMatrix | null; progress: number }>({
    rows,
    matrix: null,
    progress: 0,
  });
  useEffect(() => {
    const matrix = createIdentityMatrix(rows);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const progress = fillIdentityMatrix(matrix, 25);
      if (cancelled) return;
      setState({ rows, matrix: progress >= 1 ? matrix : null, progress });
      if (progress < 1) timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rows]);
  return state.rows === rows ? state : { matrix: null, progress: 0 };
}

/**
 * Homologues de la famille : filtres (identité, couverture, longueur,
 * organisme, redondance), regroupement des séquences proches, diversité
 * taxonomique et choix des homologues gardés pour relancer la conservation,
 * la phylogénie et la coévolution.
 */
export default function HomologsTab({
  result,
  onApply,
}: {
  result: ExplorerResult;
  onApply?: (keep: string[] | null) => Promise<void>;
}) {
  const pool = useMemo(() => homologPool(result), [result]);
  const rows = useMemo(() => pool.map((h) => h.row), [pool]);
  const { matrix, progress } = useIdentityMatrix(rows);
  const order = useMemo(() => priorityOrder(pool), [pool]);
  const nearest = useMemo(() => (matrix ? nearestIdentity(matrix) : null), [matrix]);

  // Choix manuels (identifiant → gardé ou non) : au départ, la sélection de l'analyse affichée
  const initialOverrides = useMemo(() => new Map(pool.filter((h) => !h.analysed).map((h) => [h.accession, false])), [pool]);
  const [filters, setFilters] = useState<HomologFilters>(DEFAULT_FILTERS);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(initialOverrides);
  const [rank, setRank] = useState(() => defaultRank(pool));
  const [view, setView] = useState<View>("all");
  const [sort, setSort] = useState<SortKey>("identity");
  const [limit, setLimit] = useState(PAGE);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const clusters = useMemo(() => (matrix ? clusterHomologs(matrix, order, filters.threshold / 100) : null), [matrix, order, filters.threshold]);
  const auto = useMemo(() => autoSelection(pool, filters, order, clusters), [pool, filters, order, clusters]);
  const selected = useMemo(() => pool.map((h, k) => overrides.get(h.accession) ?? auto[k]), [pool, auto, overrides]);
  const selectedIndices = useMemo(() => pool.map((_, k) => k).filter((k) => selected[k]), [pool, selected]);
  const neff = useMemo(() => (matrix ? effectiveCount(matrix, selectedIndices) : null), [matrix, selectedIndices]);
  const passing = useMemo(() => auto.filter(Boolean).length, [auto]);

  const unchanged = pool.every((h, k) => h.analysed === selected[k]);
  const waiting = filters.dedup && !clusters;
  const count = selectedIndices.length;

  const update = (patch: Partial<HomologFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };

  const setChoice = (indices: number[], value: boolean) =>
    setOverrides((current) => {
      const next = new Map(current);
      for (const k of indices) {
        // Un choix identique à la sélection automatique n'est pas retenu comme manuel
        if (auto[k] === value) next.delete(pool[k].accession);
        else next.set(pool[k].accession, value);
      }
      return next;
    });

  const reset = () => {
    setFilters(DEFAULT_FILTERS);
    setOverrides(new Map(initialOverrides));
    setLimit(PAGE);
  };

  const apply = async () => {
    if (!onApply || !count) return;
    setApplying(true);
    setApplyError(null);
    try {
      const keep = selectedIndices.map((k) => pool[k].accession);
      await onApply(keep.length === pool.length ? null : keep);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
      setApplying(false);
    }
  };

  const list = useMemo(() => {
    const indices = pool
      .map((_, k) => k)
      .filter((k) => (view === "selected" ? selected[k] : view === "removed" ? !selected[k] : true))
      // Le texte et le groupe taxonomique filtrent aussi l'affichage
      .filter((k) => {
        const h = pool[k];
        const text = filters.text.trim().toLowerCase();
        if (text && ![h.accession, h.organism, h.protein_name].some((v) => v?.toLowerCase().includes(text))) return false;
        return !filters.taxon || taxonOf(h, filters.taxon.rank) === filters.taxon.name;
      });
    const value = (k: number): number => {
      const h = pool[k];
      if (sort === "evalue") return -(h.evalue ?? Infinity);
      if (sort === "coverage") return h.coverage;
      if (sort === "length") return h.length ?? -1;
      if (sort === "redundancy") return nearest?.[k] ?? -1;
      return h.identity;
    };
    return indices.sort((a, b) => value(b) - value(a) || a - b);
  }, [pool, view, selected, filters.text, filters.taxon, sort, nearest]);

  const hasStats = pool.some((h) => h.evalue != null);
  const rankLabel = TAXON_RANKS.find((r) => r.rank === rank)?.label ?? rank;
  const allShownSelected = list.length > 0 && list.every((k) => selected[k]);
  const manual = pool.filter((h, k) => overrides.has(h.accession) && overrides.get(h.accession) !== auto[k]).length;

  // Histogramme des identités : proposés et sélectionnés
  const bins = Array.from({ length: 8 }, (_, k) => 0.2 + k * 0.1);
  const inBin = (v: number, lo: number) => v >= lo && (lo >= 0.9 ? v <= 1 : v < lo + 0.1);
  const histogram = bins.map((lo) => ({
    total: pool.filter((h) => inBin(h.identity, lo)).length,
    selected: pool.filter((h, k) => selected[k] && inBin(h.identity, lo)).length,
  }));
  const maxCount = Math.max(...histogram.map((b) => b.total), 1);

  return (
    <div className="space-y-4">
      {result.input.selection && (
        <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[14px] text-violet-900">
          Cette analyse porte sur {result.input.kept} homologue(s) choisi(s) parmi {result.input.pool ?? pool.length}. Les
          homologues écartés restent proposés ci-dessous : cochez-les pour les réintégrer.
        </p>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <h3 className="text-[16px] font-semibold text-slate-900">Sélection des homologues</h3>
          <p className="text-[13px] text-slate-500">
            Les filtres choisissent les homologues automatiquement ; cochez ou décochez ensuite chaque ligne du tableau.
            Relancez enfin l’analyse : conservation, phylogénie et coévolution seront recalculées sur la sélection.
          </p>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold text-slate-700">Identité avec la référence</legend>
            <div className="flex items-center gap-2">
              <NumberField label="min." value={filters.identityMin} min={0} max={100} suffix="%" onChange={(v) => update({ identityMin: v ?? 0 })} />
              <NumberField label="max." value={filters.identityMax} min={0} max={100} suffix="%" onChange={(v) => update({ identityMax: v ?? 100 })} />
            </div>
            <p className="text-[12px] text-slate-500">Au-dessus de 95 %, une séquence apporte peu d’information évolutive.</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold text-slate-700">Couverture et longueur</legend>
            <NumberField label="couverture min." value={filters.coverageMin} min={0} max={100} suffix="%" onChange={(v) => update({ coverageMin: v ?? 0 })} />
            <div className="flex items-center gap-2">
              <NumberField label="long. min." value={filters.lengthMin} min={0} suffix="aa" onChange={(v) => update({ lengthMin: v })} />
              <NumberField label="max." value={filters.lengthMax} min={0} suffix="aa" onChange={(v) => update({ lengthMax: v })} />
            </div>
            <p className="text-[12px] text-slate-500">Référence : {result.reference.length} résidus.</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold text-slate-700">Organisme</legend>
            <input
              value={filters.text}
              onChange={(e) => update({ text: e.target.value })}
              placeholder="Espèce, identifiant, protéine…"
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-[13px] outline-none focus:border-blue-500"
            />
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={filters.onePerSpecies} onChange={(e) => update({ onePerSpecies: e.target.checked })} />
              Une seule séquence par espèce
            </label>
            {filters.taxon && (
              <button onClick={() => update({ taxon: null })} className="text-[12px] font-semibold text-violet-700 hover:underline">
                Groupe « {filters.taxon.name} » seulement — retirer
              </button>
            )}
            {!filters.taxon && <p className="text-[12px] text-slate-500">Cliquez sur un groupe de la diversité taxonomique pour ne garder que lui.</p>}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold text-slate-700">Redondance</legend>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              Regrouper à
              <select
                value={filters.threshold}
                onChange={(e) => update({ threshold: Number(e.target.value) })}
                className="rounded-md border border-slate-300 px-2 py-1 text-[13px] outline-none focus:border-blue-500"
              >
                {THRESHOLDS.map((t) => (
                  <option key={t} value={t}>
                    {t === 100 ? "100 % (identiques)" : `≥ ${t} %`}
                  </option>
                ))}
              </select>
              d’identité
            </label>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={filters.dedup} onChange={(e) => update({ dedup: e.target.checked })} />
              Dédupliquer : un représentant par groupe
            </label>
            <p className="text-[12px] text-slate-500">
              {clusters
                ? `${clusters.size.size} groupe(s) de séquences proches. Représentant : Swiss-Prot, puis la meilleure couverture.`
                : `Calcul des identités mutuelles… ${Math.round(progress * 100)} %`}
            </p>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3 text-[14px]">
          <span>
            <b className="text-slate-900">{count}</b> / {pool.length} homologue(s) sélectionné(s)
          </span>
          <span className="text-slate-500">{passing} passent les filtres</span>
          {manual > 0 && <span className="text-slate-500">{manual} choix manuel(s)</span>}
          {neff != null && (
            <span className="text-slate-500" title="Nombre effectif de séquences : chaque séquence compte pour 1 / (nombre de séquences sélectionnées à ≥ 80 % d’identité d’elle)">
              Neff (80 %) ≈ {neff.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-100"
            >
              <RotateCcw size={13} />
              Revenir à l’analyse affichée
            </button>
            <button
              onClick={() => downloadText(`${(result.reference.accession ?? result.reference.id).replace(/[^\w.-]+/g, "_")}_selection.fasta`, selectionFasta(result, selectedIndices.map((k) => pool[k])))}
              disabled={!count}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              <Download size={13} />
              Sélection (FASTA)
            </button>
            {onApply && (
              <button
                onClick={apply}
                disabled={!count || unchanged || waiting || applying}
                title={unchanged ? "La sélection est celle de l’analyse affichée" : undefined}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0f4c81] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#0c3d68] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {applying ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Relancer l’analyse avec {count} homologue(s)
              </button>
            )}
          </div>
          {count > 0 && count < MIN_RELIABLE && (
            <p className="flex w-full items-center gap-1.5 text-[13px] text-amber-800">
              <AlertTriangle size={14} />
              Moins de {MIN_RELIABLE} homologues : la conservation et la coévolution seront peu fiables.
            </p>
          )}
          {!count && <p className="w-full text-[13px] text-rose-700">Sélectionnez au moins un homologue.</p>}
          {applyError && <p className="w-full text-[13px] text-rose-700">Relance impossible : {applyError}</p>}
        </div>
      </section>

      <HomologDiversity
        pool={pool}
        selected={selected}
        rank={rank}
        onRank={setRank}
        taxon={filters.taxon}
        onTaxon={(taxon) => update({ taxon })}
      />

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h3 className="text-[16px] font-semibold text-slate-900">Homologues : {list.length} affiché(s)</h3>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="Afficher"
              value={view}
              onChange={(v) => {
                setView(v);
                setLimit(PAGE);
              }}
              options={[
                { value: "all", label: "Tous" },
                { value: "selected", label: "Sélectionnés" },
                { value: "removed", label: "Écartés" },
              ]}
            />
            <SegmentedControl
              label="Trier par"
              value={sort}
              onChange={(v) => {
                setSort(v);
                setLimit(PAGE);
              }}
              options={[
                { value: "identity", label: "Identité" },
                { value: "evalue", label: "E-value", disabled: !hasStats },
                { value: "coverage", label: "Couverture" },
                { value: "length", label: "Longueur" },
                { value: "redundancy", label: "Redondance", disabled: !nearest },
              ]}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Cocher tous les homologues affichés"
                    title="Cocher ou décocher tous les homologues affichés"
                    checked={allShownSelected}
                    disabled={!list.length}
                    onChange={() => setChoice(list, !allShownSelected)}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Identifiant</th>
                <th className="px-3 py-2 font-semibold">Protéine</th>
                <th className="px-3 py-2 font-semibold">Espèce</th>
                <th className="px-3 py-2 font-semibold">{rankLabel}</th>
                <th className="px-3 py-2 text-right font-semibold">Longueur</th>
                <th className="px-3 py-2 text-right font-semibold">Identité</th>
                <th className="px-3 py-2 text-right font-semibold">Couverture</th>
                <th className="px-3 py-2 text-right font-semibold" title="Identité la plus forte avec un autre homologue : proche de 100 %, la séquence est redondante">
                  Redondance
                </th>
                <th className="px-3 py-2 font-semibold" title={`Groupe de séquences à ≥ ${filters.threshold} % d’identité mutuelle`}>
                  Groupe
                </th>
                <th className="px-3 py-2 text-right font-semibold" title="Score de l’alignement en bits : plus il est élevé, plus la ressemblance est forte">Score (bits)</th>
                <th className="px-3 py-2 text-right font-semibold" title="Nombre d’alignements aussi bons attendus par hasard (la P-value s’affiche au survol)">E-value</th>
                <th className="px-3 py-2 font-semibold">Origine</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, limit).map((k) => {
                const h = pool[k];
                const on = selected[k];
                const isManual = overrides.has(h.accession) && overrides.get(h.accession) !== auto[k];
                const group = clusters ? clusters.rep[k] : -1;
                const size = clusters?.size.get(group) ?? 0;
                const redundancy = nearest?.[k];
                return (
                  <tr key={h.accession} className={`border-t border-slate-100 ${on ? "" : "bg-slate-50 text-slate-400"}`}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" aria-label={`Garder ${h.accession}`} checked={on} onChange={() => setChoice([k], !on)} />
                      {isManual && <span className="ml-1 text-[11px] text-violet-700" title="Choix manuel">●</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {h.link ? (
                        <a href={h.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                          {h.accession}
                          <ExternalLink size={11} />
                        </a>
                      ) : (
                        h.accession
                      )}
                      {h.reviewed && <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-800">SP</span>}
                      {h.qcReasons && (
                        <span
                          className="ml-1 rounded bg-slate-200 px-1 font-sans text-[11px] font-semibold text-slate-700"
                          title={`Écartée par le contrôle qualité (onglet Conservation) : ${h.qcReasons.join(" ; ")}. Elle le restera tant que ces filtres sont actifs.`}
                        >
                          incomplète
                        </span>
                      )}
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-1.5" title={h.protein_name ?? ""}>
                      {h.protein_name || "—"}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-1.5 italic" title={h.organism ?? ""}>
                      {h.organism || "—"}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-1.5">{taxonOf(h, rank) ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{h.length ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pct(h.identity)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pct(h.coverage)}</td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${redundancy != null && redundancy * 100 >= filters.threshold ? "font-semibold text-amber-700" : ""}`}
                    >
                      {nearest ? pct(redundancy) : "…"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {!clusters ? "…" : size <= 1 ? (
                        <span className="text-slate-400">seule</span>
                      ) : group === k ? (
                        <span title="Représentant du groupe">★ {size} séq.</span>
                      ) : (
                        <span title={`Proche de ${pool[group].accession}`}>≈ {pool[group].accession}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{h.bits != null ? Math.round(h.bits) : "—"}</td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${on && h.evalue != null && h.evalue > 1e-3 ? "text-amber-700" : ""}`}
                      title={`P-value : ${formatEvalue(pvalue(h.evalue))}`}
                    >
                      {formatEvalue(h.evalue)}
                    </td>
                    <td className="px-3 py-1.5">{h.source === "mmseqs" ? "MMseqs2" : "UniProt / fichier"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.length > limit && (
          <button onClick={() => setLimit((l) => l + PAGE)} className="w-full border-t border-slate-100 py-2 text-[13px] font-semibold text-blue-700 hover:bg-slate-50">
            Afficher {Math.min(PAGE, list.length - limit)} de plus ({list.length - limit} restantes)
          </button>
        )}
      </section>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 lg:grid-cols-[1fr_320px]">
        <div>
          <h3 className="text-[16px] font-semibold text-slate-900">Composition de la famille</h3>
          <p className="mt-1 text-[14px] leading-6 text-slate-600">
            {result.input.sequence_count} séquence(s) importée(s), {result.input.imported_kept} retenue(s)
            {result.input.expanded ? ` et ${result.input.mmseqs_added} homologue(s) ajouté(s) par MMseqs2` : ""}.{" "}
            {result.input.prealigned
              ? "L’alignement fourni a été repris sur les colonnes de la référence."
              : "Chaque séquence a été alignée sur la référence (BLOSUM62, gaps affines)."}{" "}
            Sont écartées les séquences qui couvrent moins de 50 % de la référence ou qui lui sont identiques à moins de 20 %.
            Une famille variée (identités de 30 à 90 %) donne la conservation la plus informative. E-value : nombre
            d’alignements aussi bons attendus par hasard entre deux séquences de ces longueurs (statistique de
            Karlin-Altschul, comme BLAST, calculée de la même façon pour toutes les lignes) ; en dessous de 10⁻³, la
            ressemblance n’est pas due au hasard. P-value = 1 − e<sup>−E</sup>. Redondance : identité la plus forte avec
            un autre homologue, sur les positions alignées des deux séquences.
          </p>
          {result.input.excluded.length > 0 && (
            <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-[13px]">
              <summary className="cursor-pointer font-semibold text-slate-700">
                {result.input.excluded.length} séquence(s) écartée(s) à l’alignement
              </summary>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto">
                {result.input.excluded.map((e) => (
                  <li key={e.id}>
                    <span className="font-mono">{e.id}</span> — {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div>
          <p className="mb-1 text-[13px] font-semibold text-slate-700">Identité avec la référence</p>
          <div className="flex h-28 items-end gap-1">
            {histogram.map((b, k) => (
              <div key={k} className="flex flex-1 flex-col items-center gap-0.5" title={`${b.selected} sélectionné(s) sur ${b.total}`}>
                <span className="text-[11px] text-slate-500">{b.total || ""}</span>
                <div className="relative w-full rounded-t bg-violet-200" style={{ height: `${(b.total / maxCount) * 80}px` }}>
                  <div className="absolute inset-x-0 bottom-0 rounded-t bg-violet-600" style={{ height: `${(b.selected / maxCount) * 80}px` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[11px] text-slate-500">
            {bins.map((lo) => (
              <span key={lo} className="flex-1 text-center">
                {Math.round(lo * 100)}
              </span>
            ))}
          </div>
          <p className="text-center text-[11px] text-slate-500">% d’identité (foncé : sélectionnés)</p>
        </div>
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  suffix: string;
}) {
  return (
    <label className="flex items-center gap-1 text-[13px] text-slate-600">
      {label}
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-16 rounded-md border border-slate-300 px-1.5 py-1 text-right text-[13px] tabular-nums outline-none focus:border-blue-500"
      />
      {suffix}
    </label>
  );
}
