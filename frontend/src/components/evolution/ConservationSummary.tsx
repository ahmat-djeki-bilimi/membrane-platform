"use client";

import Link from "next/link";
import { ArrowRight, GitBranch, Loader2 } from "lucide-react";
import ConservationProfile from "./ConservationProfile";
import { useConservation } from "@/lib/conservation";

const fmt = (v?: number | null) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Aperçu de la conservation dans la page Analyse de séquence. */
export default function ConservationSummary({ accession }: { accession: string }) {
  const { status, result, error } = useConservation(accession);

  return (
    <section className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
      <span className="absolute inset-x-0 top-0 h-1 bg-violet-600" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md bg-violet-600 p-2 text-white shadow-sm">
            <GitBranch size={16} />
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-violet-700">Évolution</p>
            <h2 className="text-[17px] font-semibold text-slate-900">Conservation des résidus</h2>
          </div>
        </div>
        <Link
          href={`/structures/${accession}?tab=evolution`}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[14px] font-semibold text-white hover:bg-violet-700"
        >
          Analyse complète (3D, alignement)
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="p-4">
        {status === "succeeded" && result ? (
          <>
            <p className="mb-2 text-[14px] text-slate-600">
              {result.sequence_count} séquences de {result.species_count} espèces (cluster{" "}
              {result.cluster_id}) · conservation moyenne dans la membrane{" "}
              <span className="font-semibold text-slate-900">{fmt(result.summary.tm_mean_score)}</span>, hors
              membrane <span className="font-semibold text-slate-900">{fmt(result.summary.loop_mean_score)}</span>
            </p>
            <ConservationProfile positions={result.positions} tmSegments={result.summary.tm_segments} />
          </>
        ) : status === "failed" ? (
          <p className="text-[14px] text-rose-700">Analyse évolutive impossible : {error}</p>
        ) : (
          <p className="flex items-center gap-2 text-[14px] text-slate-500">
            <Loader2 size={16} className="animate-spin text-violet-600" />
            Recherche des homologues et calcul de la conservation…
          </p>
        )}
      </div>
    </section>
  );
}
