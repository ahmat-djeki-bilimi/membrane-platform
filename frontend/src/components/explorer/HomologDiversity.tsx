"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { TAXON_RANKS, shannon, taxonCounts, taxonOf, type PoolEntry } from "@/lib/homologs";

const MAX_BARS = 12;

/** Diversité taxonomique des homologues proposés et de la sélection ; un clic sur un groupe filtre le tableau. */
export default function HomologDiversity({
  pool,
  selected,
  rank,
  onRank,
  taxon,
  onTaxon,
}: {
  pool: PoolEntry[];
  selected: boolean[];
  rank: string;
  onRank: (rank: string) => void;
  taxon: { rank: string; name: string } | null;
  onTaxon: (taxon: { rank: string; name: string } | null) => void;
}) {
  const counts = useMemo(() => taxonCounts(pool, selected, rank), [pool, selected, rank]);
  const stats = useMemo(() => {
    const distinct = (r: string, only: boolean) =>
      new Set(pool.filter((_, k) => !only || selected[k]).map((h) => taxonOf(h, r)).filter(Boolean)).size;
    const species = taxonCounts(pool, selected, "species").filter((c) => c.name !== null);
    const top = [...species].sort((a, b) => b.selected - a.selected)[0];
    return {
      species: [distinct("species", true), distinct("species", false)],
      genera: [distinct("genus", true), distinct("genus", false)],
      groups: [distinct(rank, true), distinct(rank, false)],
      shannon: shannon(species.map((c) => c.selected)),
      top: top && top.selected > 1 ? top : null,
    };
  }, [pool, selected, rank]);

  const label = TAXON_RANKS.find((r) => r.rank === rank)?.label ?? rank;
  const known = counts.filter((c) => c.name !== null);
  const unknown = counts.find((c) => c.name === null);
  const shown = known.slice(0, MAX_BARS);
  const others = known.slice(MAX_BARS);
  const max = Math.max(...counts.map((c) => c.total), 1);
  const noLineage = !["genus", "species"].includes(rank) && pool.every((h) => !Object.keys(h.lineage).length);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-slate-900">Diversité taxonomique</h3>
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          Rang
          <select
            value={rank}
            onChange={(e) => onRank(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-[13px] outline-none focus:border-blue-500"
          >
            {TAXON_RANKS.map((r) => (
              <option key={r.rank} value={r.rank}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Espèces" value={stats.species} />
        <Stat label="Genres" value={stats.genera} />
        <Stat label={`${label}s distincts`} value={stats.groups} />
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-slate-500" title="Indice de Shannon des espèces de la sélection : plus il est élevé, plus les espèces sont nombreuses et également représentées">
            Indice de Shannon (espèces)
          </dt>
          <dd className="text-[16px] font-semibold tabular-nums text-slate-900">{stats.shannon.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</dd>
        </div>
      </dl>
      {stats.top && (
        <p className="mt-2 text-[13px] text-slate-600">
          Espèce la plus représentée dans la sélection : <i>{stats.top.name}</i> ({stats.top.selected} séquences). Gardez
          plutôt une séquence par espèce pour ne pas biaiser la conservation et l’arbre.
        </p>
      )}

      {noLineage ? (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          Lignées taxonomiques indisponibles pour cette analyse : choisissez le rang Genre ou Espèce, ou relancez l’analyse.
        </p>
      ) : (
        <div className="mt-3 space-y-1">
          {taxon && (
            <button
              onClick={() => onTaxon(null)}
              className="mb-1 inline-flex items-center gap-1 rounded bg-violet-100 px-2 py-0.5 text-[12px] font-semibold text-violet-800 hover:bg-violet-200"
            >
              Filtre : {taxon.name}
              <X size={12} />
            </button>
          )}
          {shown.map((c) => {
            const active = taxon?.rank === rank && taxon.name === c.name;
            return (
              <button
                key={c.name}
                onClick={() => onTaxon(active ? null : { rank, name: c.name! })}
                title={active ? "Retirer ce filtre" : "N’afficher et ne sélectionner que ce groupe"}
                className={`grid w-full grid-cols-[minmax(0,180px)_1fr_70px] items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] hover:bg-slate-50 ${
                  active ? "bg-violet-50 ring-1 ring-violet-300" : ""
                }`}
              >
                <span className={`truncate ${rank === "species" || rank === "genus" ? "italic" : ""}`}>{c.name}</span>
                <span className="relative h-3 rounded bg-slate-100">
                  <span className="absolute inset-y-0 left-0 rounded bg-violet-200" style={{ width: `${(c.total / max) * 100}%` }} />
                  <span className="absolute inset-y-0 left-0 rounded bg-violet-600" style={{ width: `${(c.selected / max) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums text-slate-600">
                  {c.selected} / {c.total}
                </span>
              </button>
            );
          })}
          {others.length > 0 && (
            <p className="px-1 text-[12px] text-slate-500">
              + {others.length} autre(s) groupe(s) : {others.reduce((s, c) => s + c.selected, 0)} / {others.reduce((s, c) => s + c.total, 0)} séquences
            </p>
          )}
          {unknown && (
            <p className="px-1 text-[12px] text-slate-500">
              Rang non renseigné : {unknown.selected} / {unknown.total} séquences
            </p>
          )}
          <p className="flex items-center gap-3 px-1 pt-1 text-[12px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-violet-600" /> sélectionnés
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-violet-200" /> proposés
            </span>
          </p>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value: [selected, total] }: { label: string; value: number[] }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-[16px] font-semibold tabular-nums text-slate-900">
        {selected} <span className="text-[13px] font-normal text-slate-500">/ {total} proposés</span>
      </dd>
    </div>
  );
}
