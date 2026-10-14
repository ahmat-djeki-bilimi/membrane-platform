"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, GitCompare, History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { StatusBadge } from "@/components/runs/RunViews";
import { forgetRun, formatDate, formatDuration, readHistory, runsApi, type Run } from "@/lib/runs";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

type Filter = "all" | "succeeded" | "failed" | "active";

/** Analyses lancées ou consultées depuis ce navigateur, avec leur traçabilité. */
export default function AnalysesPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    const ids = readHistory().map((e) => e.id);
    runsApi
      .list(ids)
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, []);

  const kinds = useMemo(() => [...new Map((runs ?? []).map((r) => [r.kind, r.label])).entries()], [runs]);
  const shown = (runs ?? []).filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (filter === "all" || (filter === "active" ? r.status === "queued" || r.status === "running" : r.status === filter))
  );

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  const resume = async (run: Run) => {
    setBusy(run.id);
    try {
      await runsApi.resume(run.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="analyses" />
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-6 lg:px-6">
          <nav className="flex items-center gap-1 text-[13px] text-blue-200">
            <Link href="/" className="hover:text-white">
              Accueil
            </Link>
            <ChevronRight size={12} />
            <span className="text-white">Analyses</span>
          </nav>
          <h1 className="mt-2 flex items-center gap-2 text-[28px] font-bold text-white">
            <History size={26} />
            Mes analyses
          </h1>
          <p className="mt-1 max-w-3xl text-[15px] text-blue-100">
            Chaque calcul est enregistré avec ses entrées, les versions des bases de données, les outils, les paramètres, les étapes, le
            résultat et les erreurs. Reprenez une analyse interrompue, comparez deux exécutions, exportez un rapport PDF ou les données.
          </p>
        </div>
      </section>

      <main className="w-full flex-1 space-y-4 px-4 py-5 lg:px-6">
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[13px]">
          <label className="flex items-center gap-1.5">
            Statut
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded-md border border-slate-300 px-2 py-1">
              <option value="all">tous</option>
              <option value="succeeded">terminées</option>
              <option value="failed">en échec</option>
              <option value="active">en cours</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1">
              <option value="all">tous</option>
              {kinds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => router.push(`/analyses/comparer?a=${selected[0]}&b=${selected[1]}`)}
            disabled={selected.length !== 2}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#0f4c81] px-3 py-1.5 font-semibold text-white hover:bg-[#0c3d68] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GitCompare size={14} />
            Comparer les 2 exécutions cochées
          </button>
          <Link href="/projets" className="font-semibold text-blue-700 hover:underline">
            Mes projets →
          </Link>
        </section>

        {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[14px] text-rose-800">{error}</p>}
        {!runs && !error && (
          <p className="flex items-center gap-2 text-[14px] text-slate-500">
            <Loader2 size={15} className="animate-spin" /> Chargement…
          </p>
        )}
        {runs && runs.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-[15px] text-slate-600">
            Aucune analyse dans ce navigateur pour l’instant. Les analyses lancées depuis l’Explorateur, la Comparaison, la conservation ou la
            structure prédite apparaîtront ici. Pour les retrouver sur un autre appareil, enregistrez-les dans un projet.
          </div>
        )}

        {shown.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 font-semibold">Analyse</th>
                  <th className="px-3 py-2 font-semibold">Entrées</th>
                  <th className="px-3 py-2 font-semibold">Statut</th>
                  <th className="px-3 py-2 font-semibold">Créée</th>
                  <th className="px-3 py-2 text-right font-semibold">Durée</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((run) => (
                  <tr key={run.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.includes(run.id)} onChange={() => toggle(run.id)} aria-label="Sélectionner pour comparer" />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/analyses/${run.id}`} className="font-semibold text-slate-900 hover:text-blue-700 hover:underline">
                        {run.label}
                      </Link>
                      <span className="ml-2 font-mono text-[11px] text-slate-400">{run.id.slice(0, 8)}</span>
                      {run.parent_id && <span className="ml-1 rounded bg-violet-50 px-1 text-[11px] text-violet-700">nouvelle exécution</span>}
                    </td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-slate-600" title={run.inputs.map((i) => `${i.kind} ${i.id}`).join(" · ")}>
                      {run.inputs.map((i) => i.id).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={run.status} stale={run.stale} />
                      {run.attempts > 1 && <span className="ml-1 text-[11px] text-slate-500">{run.attempts} tentatives</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{formatDate(run.created_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatDuration(run.provenance?.duration)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {run.can_resume && (
                        <button onClick={() => resume(run)} disabled={busy === run.id} className="mr-2 inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-50">
                          {busy === run.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                          Reprendre
                        </button>
                      )}
                      <button
                        onClick={() => {
                          forgetRun(run.id);
                          setRuns((list) => (list ?? []).filter((r) => r.id !== run.id));
                        }}
                        title="Retirer de cet historique (l’exécution reste sur le serveur)"
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[12px] text-slate-500">
          L’historique est gardé dans ce navigateur. Les exécutions elles-mêmes restent sur le serveur : leur adresse suffit pour les rouvrir,
          et un projet permet de les retrouver depuis un autre appareil.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
