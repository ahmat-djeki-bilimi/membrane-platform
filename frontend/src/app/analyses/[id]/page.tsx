"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, ChevronRight, Copy, GitCompare, Loader2, RotateCcw } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SaveToProject from "@/components/SaveToProject";
import { Exports, InputsList, Section, SourcesTable, StatusBadge, StepsTimeline } from "@/components/runs/RunViews";
import { formatDate, formatDuration, rememberRun, resultPath, runsApi, type Run } from "@/lib/runs";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

/** Fiche d'une exécution : traçabilité complète, reprise, nouvelle exécution, exports. */
export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resume" | "rerun" | null>(null);

  const load = useCallback(() => {
    runsApi
      .get(id)
      .then((data) => {
        setRun(data);
        rememberRun(data.id, data.kind);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  useEffect(load, [load]);

  // Suivi tant que l'exécution n'est pas terminée
  const active = run && (run.status === "queued" || run.status === "running") && !run.stale;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(load, 4000);
    return () => clearTimeout(timer);
  }, [active, run, load]);

  const act = async (kind: "resume" | "rerun") => {
    if (!run) return;
    setBusy(kind);
    setError(null);
    try {
      const next = kind === "resume" ? await runsApi.resume(run.id) : await runsApi.rerun(run.id);
      if (kind === "rerun") router.push(`/analyses/${next.id}`);
      else setRun({ ...run, ...next });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const result = run ? resultPath(run) : null;
  const provenance = run?.provenance;

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="analyses" />
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-5 lg:px-6">
          <nav className="flex items-center gap-1 text-[13px] text-blue-200">
            <Link href="/" className="hover:text-white">
              Accueil
            </Link>
            <ChevronRight size={12} />
            <Link href="/analyses" className="hover:text-white">
              Analyses
            </Link>
            <ChevronRight size={12} />
            <span className="font-mono text-cyan-200">{id.slice(0, 8)}</span>
          </nav>
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-[24px] font-bold text-white">{run?.label ?? "Exécution"}</h1>
              {run && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-blue-100">
                  <StatusBadge status={run.status} stale={run.stale} />
                  <span>créée le {formatDate(run.created_at)}</span>
                  {run.finished_at && <span>· terminée le {formatDate(run.finished_at)}</span>}
                  {provenance && <span>· {formatDuration(provenance.duration)} de calcul</span>}
                  {run.attempts > 1 && <span>· {run.attempts} tentatives</span>}
                </p>
              )}
            </div>
            {run && (
              <div className="flex flex-wrap gap-2">
                {result && run.status === "succeeded" && (
                  <Link href={result} className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-[14px] font-semibold text-[#0f4c81] hover:bg-blue-50">
                    Voir le résultat <ArrowRight size={14} />
                  </Link>
                )}
                {run.can_resume && (
                  <button onClick={() => act("resume")} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-100 px-3 py-2 text-[14px] font-semibold text-amber-900 hover:bg-amber-50">
                    {busy === "resume" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                    Reprendre l’analyse
                  </button>
                )}
                <button
                  onClick={() => act("rerun")}
                  disabled={busy !== null || !!active}
                  title="Relance le calcul avec les mêmes paramètres, pour comparer deux exécutions"
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] font-medium text-white hover:bg-white/20 disabled:opacity-50"
                >
                  {busy === "rerun" ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                  Nouvelle exécution
                </button>
                {run.parent_id && (
                  <Link href={`/analyses/comparer?a=${run.parent_id}&b=${run.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] font-medium text-white hover:bg-white/20">
                    <GitCompare size={14} />
                    Comparer à l’exécution d’origine
                  </Link>
                )}
                <SaveToProject kind="run" title={`${run.label} (${run.id.slice(0, 8)})`} payload={{ job_id: run.id, kind: run.kind }} variant="dark" />
              </div>
            )}
          </div>
        </div>
      </section>

      <main className="w-full flex-1 space-y-4 px-4 py-4 lg:px-6">
        {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[14px] text-rose-800">{error}</p>}
        {!run && !error && (
          <p className="flex items-center gap-2 text-[14px] text-slate-500">
            <Loader2 size={15} className="animate-spin" /> Chargement…
          </p>
        )}
        {run && (
          <>
            {run.stale && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                Cette analyse est en cours depuis anormalement longtemps : le serveur a probablement été arrêté pendant le calcul. Reprenez-la :
                les données externes déjà obtenues sont relues depuis le cache.
              </p>
            )}
            {run.error && (
              <Section title="Erreur de l’exécution">
                <p className="font-mono text-[13px] text-rose-800">{run.error}</p>
                {run.can_resume && <p className="mt-2 text-[13px] text-slate-600">Vous pouvez reprendre l’analyse (bouton en haut) : la tentative actuelle sera gardée dans l’historique.</p>}
              </Section>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <Section title="Résultats principaux">
                {Object.keys(run.summary).length ? (
                  <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[200px_1fr]">
                    {Object.entries(run.summary).map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="text-slate-500">{key}</dt>
                        <dd className="font-semibold text-slate-900">{value === null || value === undefined || value === "" ? "—" : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-[14px] text-slate-500">{run.status === "succeeded" ? "Aucun indicateur résumé pour ce type d’analyse." : "Pas encore de résultat."}</p>
                )}
              </Section>
              <Section title="Étapes du pipeline" subtitle="Ordre, durée, réponses relues du cache et erreur éventuelle de chaque étape.">
                <StepsTimeline steps={provenance?.steps ?? []} />
              </Section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Section title="Entrées" subtitle="Séquences et structures utilisées ; les longues entrées sont résumées par leur empreinte SHA-256.">
                <InputsList run={run} />
              </Section>
              <Section title="Sources de données et versions">
                <SourcesTable sources={provenance?.sources ?? []} />
              </Section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Section title="Méthodes et outils" subtitle={provenance ? `Empreinte des entrées et paramètres : ${provenance.fingerprint}` : undefined}>
                <ul className="space-y-1 text-[13px]">
                  {(run.methods ?? []).map((m) => (
                    <li key={m.name}>
                      <b className="text-slate-900">{m.name}</b> <span className="text-slate-500">— {m.reference}</span>
                      {m.platform_version != null && <span className="ml-1 rounded bg-slate-100 px-1 text-[11px]">méthode v{m.platform_version}</span>}
                    </li>
                  ))}
                </ul>
                {provenance?.environment && (
                  <p className="mt-2 text-[12px] text-slate-500">
                    Environnement :{" "}
                    {Object.entries(provenance.environment)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(" · ")}
                  </p>
                )}
              </Section>
              <Section title="Paramètres">
                <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[160px_1fr]">
                  {Object.entries(run.params_digest).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-slate-500">{key}</dt>
                      <dd className="break-all font-mono text-slate-800">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            </div>

            {run.history.length > 0 && (
              <Section title="Tentatives précédentes" subtitle="Chaque reprise garde la trace de la tentative interrompue ou en échec.">
                <ul className="space-y-2 text-[13px]">
                  {run.history.map((attempt) => (
                    <li key={attempt.attempt} className="rounded-md border border-slate-200 p-2">
                      <p className="flex flex-wrap items-center gap-2">
                        <b>Tentative {attempt.attempt}</b> <StatusBadge status={attempt.status} />
                        <span className="text-slate-500">
                          {formatDate(attempt.started_at)} → {formatDate(attempt.finished_at)}
                        </span>
                      </p>
                      {attempt.error && <p className="mt-1 font-mono text-rose-800">{attempt.error}</p>}
                      {attempt.steps.length > 0 && <p className="mt-1 text-slate-600">Étapes atteintes : {attempt.steps.map((s) => `${s.name} (${s.status === "succeeded" ? "terminée" : s.status})`).join(" → ")}</p>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Rapport et données">
              <Exports run={run} />
            </Section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
