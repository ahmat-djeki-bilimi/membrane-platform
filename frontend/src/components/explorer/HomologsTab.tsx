"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import type { ExplorerResult } from "@/lib/explorer";

const PAGE = 50;

type SortKey = "identity" | "evalue" | "coverage";

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

/** Homologues retenus (identité, couverture, espèce, origine) et séquences écartées. */
export default function HomologsTab({ result }: { result: ExplorerResult }) {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<SortKey>("identity");
  const homologs = useMemo(() => {
    const text = filter.trim().toLowerCase();
    const list = text
      ? result.homologs.filter((h) =>
          [h.accession, h.organism, h.protein_name].some((v) => v?.toLowerCase().includes(text))
        )
      : [...result.homologs];
    if (sort === "evalue") list.sort((a, b) => (a.evalue ?? Infinity) - (b.evalue ?? Infinity));
    else if (sort === "coverage") list.sort((a, b) => b.coverage - a.coverage);
    else list.sort((a, b) => b.identity - a.identity);
    return list;
  }, [result, filter, sort]);
  const hasStats = result.homologs.some((h) => h.evalue != null);

  const identities = result.homologs.map((h) => h.identity).sort((a, b) => a - b);
  const bins = Array.from({ length: 8 }, (_, k) => 0.2 + k * 0.1);
  const counts = bins.map((lo) => identities.filter((v) => v >= lo && (lo >= 0.9 ? v <= 1 : v < lo + 0.1)).length);
  const maxCount = Math.max(...counts, 1);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h3 className="text-[16px] font-semibold text-slate-900">Résultat de l’alignement : {result.homologs.length} homologues</h3>
          <div className="flex flex-wrap items-center gap-2">
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
            ]}
          />
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Filtrer (espèce, identifiant…)"
            className="w-64 rounded-md border border-slate-300 px-2 py-1 text-[13px] outline-none focus:border-blue-500"
          />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Identifiant</th>
                <th className="px-3 py-2 font-semibold">Protéine</th>
                <th className="px-3 py-2 font-semibold">Espèce</th>
                <th className="px-3 py-2 text-right font-semibold">Identité</th>
                <th className="px-3 py-2 text-right font-semibold">Couverture</th>
                <th className="px-3 py-2 text-right font-semibold" title="Score de l’alignement en bits : plus il est élevé, plus la ressemblance est forte">Score (bits)</th>
                <th className="px-3 py-2 text-right font-semibold" title="Nombre d’alignements aussi bons attendus par hasard">E-value</th>
                <th className="px-3 py-2 text-right font-semibold" title="Probabilité d’obtenir au moins un alignement aussi bon par hasard">P-value</th>
                <th className="px-3 py-2 font-semibold">Origine</th>
              </tr>
            </thead>
            <tbody>
              {homologs.slice(0, limit).map((h) => (
                <tr key={h.accession} className="border-t border-slate-100">
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
                  </td>
                  <td className="max-w-[280px] truncate px-3 py-1.5 text-slate-700" title={h.protein_name ?? ""}>
                    {h.protein_name || "—"}
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-1.5 italic text-slate-700" title={h.organism ?? ""}>
                    {h.organism || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(h.identity * 100)} %</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(h.coverage * 100)} %</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{h.bits != null ? Math.round(h.bits) : "—"}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${h.evalue != null && h.evalue > 1e-3 ? "text-amber-700" : ""}`}>{formatEvalue(h.evalue)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{formatEvalue(pvalue(h.evalue))}</td>
                  <td className="px-3 py-1.5 text-slate-500">{h.source === "mmseqs" ? "MMseqs2" : "UniProt / fichier"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {homologs.length > limit && (
          <button onClick={() => setLimit((l) => l + PAGE)} className="w-full border-t border-slate-100 py-2 text-[13px] font-semibold text-blue-700 hover:bg-slate-50">
            Afficher {Math.min(PAGE, homologs.length - limit)} de plus ({homologs.length - limit} restantes)
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
            ressemblance n’est pas due au hasard. P-value = 1 − e<sup>−E</sup>.
          </p>
          {result.input.excluded.length > 0 && (
            <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-[13px]">
              <summary className="cursor-pointer font-semibold text-slate-700">
                {result.input.excluded.length} séquence(s) écartée(s)
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
            {counts.map((c, k) => (
              <div key={k} className="flex flex-1 flex-col items-center gap-0.5">
                <span className="text-[11px] text-slate-500">{c || ""}</span>
                <div className="w-full rounded-t bg-violet-500" style={{ height: `${(c / maxCount) * 80}px` }} />
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
          <p className="text-center text-[11px] text-slate-500">% d’identité</p>
        </div>
      </section>

    </div>
  );
}
