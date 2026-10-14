// Contrôle qualité de l'alignement (onglet Conservation) : aperçu des filtres
// avant de relancer le calcul, et correspondance colonnes ↔ résidus.

import { toCsv, type AlignmentQuality, type ExplorerResult, type QualityParams } from "./explorer";

/** Réglages tels qu'affichés dans le formulaire (pourcentages ; null = filtre inactif). */
export type QualityForm = {
  minCoverage: number | null;
  maxInternalGap: number | null;
  maxColumnGaps: number | null;
  maskPoorRegions: boolean;
};

export const EMPTY_FORM: QualityForm = { minCoverage: null, maxInternalGap: null, maxColumnGaps: null, maskPoorRegions: false };

/** Réglages proposés : seuils usuels (couverture ≥ 70 %, colonnes à moins de 50 % de gaps). */
export const SUGGESTED_FORM: QualityForm = { minCoverage: 70, maxInternalGap: 50, maxColumnGaps: 50, maskPoorRegions: true };

export function formFromParams(params: QualityParams | null | undefined): QualityForm {
  const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 10);
  return {
    minCoverage: pct(params?.min_coverage),
    maxInternalGap: params?.max_internal_gap ?? null,
    maxColumnGaps: pct(params?.max_column_gaps),
    maskPoorRegions: !!params?.mask_poor_regions,
  };
}

/** Réglages envoyés au serveur ; null si aucun filtre n'est actif. */
export function paramsFromForm(form: QualityForm): QualityParams | null {
  const params: QualityParams = {};
  if (form.minCoverage != null) params.min_coverage = form.minCoverage / 100;
  if (form.maxInternalGap != null) params.max_internal_gap = form.maxInternalGap;
  if (form.maxColumnGaps != null) params.max_column_gaps = form.maxColumnGaps / 100;
  if (form.maskPoorRegions) params.mask_poor_regions = true;
  return Object.keys(params).length ? params : null;
}

export const sameForm = (a: QualityForm, b: QualityForm) =>
  a.minCoverage === b.minCoverage && a.maxInternalGap === b.maxInternalGap && a.maxColumnGaps === b.maxColumnGaps && a.maskPoorRegions === b.maskPoorRegions;

export type QualityPreview = {
  /** Séquences gardées / écartées avec ces réglages (identifiants). */
  kept: string[];
  removed: { accession: string; reasons: string[] }[];
  /** Fraction de gaps de chaque colonne parmi les séquences gardées. */
  gapFraction: number[];
  masked: boolean[];
  maskedCount: number;
};

/**
 * Effet des réglages sur l'alignement, calculé dans le navigateur à partir des
 * statistiques du serveur (couverture, trous) et des lignes alignées. Les
 * régions mal alignées sont celles de l'analyse affichée ; le serveur les
 * recalcule à la relance sur les séquences gardées.
 */
export function previewQuality(result: ExplorerResult, quality: AlignmentQuality, form: QualityForm): QualityPreview {
  const rows = new Map<string, string>();
  for (const m of result.msa) rows.set(m.accession, m.row);
  for (const r of quality.removed) rows.set(r.accession, r.row);

  const kept: string[] = [];
  const removed: QualityPreview["removed"] = [];
  for (const s of quality.sequences) {
    const reasons: string[] = [];
    if (form.minCoverage != null && s.coverage * 100 < form.minCoverage - 1e-9) reasons.push(`couverture ${Math.round(s.coverage * 100)} %`);
    if (form.maxInternalGap != null && s.longest_internal_gap > form.maxInternalGap) reasons.push(`trou interne de ${s.longest_internal_gap} positions`);
    if (reasons.length) removed.push({ accession: s.accession, reasons });
    else kept.push(s.accession);
  }

  const length = result.query_sequence.length;
  const gaps = new Array<number>(length).fill(0);
  for (const id of kept) {
    const row = rows.get(id);
    if (!row) continue;
    for (let k = 0; k < length; k++) if (row[k] === "-") gaps[k]++;
  }
  const gapFraction = gaps.map((g) => (kept.length ? g / kept.length : 0));
  const masked = gapFraction.map((g) => form.maxColumnGaps != null && g * 100 > form.maxColumnGaps + 1e-9);
  if (form.maskPoorRegions) {
    for (const r of quality.poor_regions) for (let k = r.start - 1; k < r.end; k++) masked[k] = true;
  }
  return { kept, removed, gapFraction, masked, maskedCount: masked.filter(Boolean).length };
}

/**
 * Correspondance exacte colonne ↔ résidu : la colonne k de l'alignement est le
 * résidu k de la référence (colonne d'origine si l'alignement a été importé).
 */
export function mappingCsv(result: ExplorerResult, quality: AlignmentQuality) {
  const c = quality.columns;
  const source = quality.mapping.source_columns;
  return toCsv(
    ["colonne_alignement", "position_reference", "residu_reference", "colonne_fichier_importe", "gaps", "identite_reference", "similarite_reference", "masquee", "raison", "grade"],
    result.positions.map((p, k) => [
      k + 1,
      p.position,
      result.query_sequence[k],
      source ? source[k] : "",
      c.gap_fraction[k],
      c.identity[k],
      c.similarity[k],
      c.masked[k] ? "oui" : "non",
      c.reasons[k] ?? "",
      p.grade,
    ])
  );
}

/** Vérifie dans le navigateur que chaque ligne a la longueur de la référence et que la position k porte le résidu k. */
export function checkMapping(result: ExplorerResult): { exact: boolean; problems: string[] } {
  const length = result.query_sequence.length;
  const problems: string[] = [];
  result.positions.forEach((p, k) => {
    if (p.position !== k + 1 || p.residue !== result.query_sequence[k]) problems.push(`position ${k + 1}`);
  });
  if (result.positions.length !== length) problems.push(`${result.positions.length} positions pour ${length} résidus`);
  for (const m of result.msa) if (m.row.length !== length) problems.push(`ligne ${m.accession}`);
  return { exact: problems.length === 0, problems: problems.slice(0, 5) };
}
