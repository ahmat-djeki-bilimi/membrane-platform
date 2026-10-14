"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronRight, GitCompare, Loader2, XCircle } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { Section, StatusBadge } from "@/components/runs/RunViews";
import { formatDate, formatDuration, runsApi, type RunComparison } from "@/lib/runs";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

export default function CompareRunsPage() {
  return (
    <Suspense fallback={null}>
      <CompareRuns />
    </Suspense>
  );
}

const show = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));

function DiffTable({ rows, onlyDifferences }: { rows: { key: string; a: unknown; b: unknown; same: boolean }[]; onlyDifferences: boolean }) {
  const shown = onlyDifferences ? rows.filter((r) => !r.same) : rows;
  if (!shown.length) return <p className="text-[14px] text-emerald-800">Aucune différence.</p>;
  return (
    <table className="w-full text-[13px]">
      <thead className="text-left text-slate-500">
        <tr>
          <th className="py-1 pr-3 font-semibold" />
          <th className="py-1 pr-3 font-semibold">Exécution A</th>
          <th className="py-1 pr-3 font-semibold">Exécution B</th>
          <th className="w-6" />
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => (
          <tr key={row.key} className={`border-t border-slate-100 ${row.same ? "" : "bg-amber-50"}`}>
            <td className="py-1 pr-3 text-slate-600">{row.key}</td>
            <td className="break-all py-1 pr-3 font-mono">{show(row.a)}</td>
            <td className="break-all py-1 pr-3 font-mono">{show(row.b)}</td>
            <td>{row.same ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-amber-600" />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompareRuns() {
  const params = useSearchParams();
  const a = params.get("a");
  const b = params.get("b");
  const [data, setData] = useState<RunComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyDifferences, setOnlyDifferences] = useState(false);

  useEffect(() => {
    if (!a || !b) return;
    runsApi
      .compare(a, b)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [a, b]);

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="analyses" />
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-5 lg:px-6">
          <nav className="flex items-center gap-1 text-[13px] text-blue-200">
            <Link href="/analyses" className="hover:text-white">
              Analyses
            </Link>
            <ChevronRight size={12} />
            <span className="text-white">Comparer deux exécutions</span>
          </nav>
          <h1 className="mt-2 flex items-center gap-2 text-[24px] font-bold text-white">
            <GitCompare size={22} />
            Comparaison de deux exécutions
          </h1>
        </div>
      </section>

      <main className="w-full flex-1 space-y-4 px-4 py-4 lg:px-6">
        {(!a || !b) && <p className="text-[14px] text-slate-600">Choisissez deux exécutions dans la page Analyses.</p>}
        {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[14px] text-rose-800">{error}</p>}
        {a && b && !data && !error && (
          <p className="flex items-center gap-2 text-[14px] text-slate-500">
            <Loader2 size={15} className="animate-spin" /> Comparaison…
          </p>
        )}
        {data && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {(["a", "b"] as const).map((side) => {
                const run = data[side];
                return (
                  <Link key={side} href={`/analyses/${run.id}`} className="rounded-lg border border-slate-200 bg-white p-3 hover:border-[#0f4c81]">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500">Exécution {side.toUpperCase()}</p>
                    <p className="font-semibold text-slate-900">{run.label}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                      <span className="font-mono">{run.id.slice(0, 8)}</span>
                      <StatusBadge status={run.status} stale={run.stale} />
                      {formatDate(run.created_at)} · {formatDuration(run.provenance?.duration)}
                    </p>
                  </Link>
                );
              })}
            </div>

            <p
              className={`rounded-lg border px-3 py-2 text-[14px] ${
                data.same_fingerprint ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {!data.same_kind
                ? "Les deux exécutions ne sont pas du même type : seuls les éléments communs sont comparés."
                : data.same_fingerprint
                  ? "Mêmes entrées et mêmes paramètres : une différence de résultat vient des versions des sources de données, de la version de méthode ou du hasard (graines identiques par construction)."
                  : "Entrées ou paramètres différents : les écarts de résultat peuvent venir de ces réglages."}
            </p>
            <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
              <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />
              Afficher seulement les différences
            </label>

            <div className="grid gap-4 xl:grid-cols-2">
              <Section title="Résultats principaux">
                <DiffTable rows={data.summary} onlyDifferences={onlyDifferences} />
              </Section>
              <Section title="Paramètres">
                <DiffTable rows={data.params} onlyDifferences={onlyDifferences} />
              </Section>
            </div>

            {Object.keys(data.overlaps).length > 0 && (
              <Section title="Recouvrement des résultats" subtitle="Positions retrouvées dans les deux exécutions (indice de Jaccard : 1 = identiques).">
                <table className="w-full text-[13px]">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 font-semibold" />
                      <th className="py-1 text-right font-semibold">A</th>
                      <th className="py-1 text-right font-semibold">B</th>
                      <th className="py-1 text-right font-semibold">Communes</th>
                      <th className="py-1 text-right font-semibold">Jaccard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.overlaps).map(([label, o]) => (
                      <tr key={label} className="border-t border-slate-100">
                        <td className="py-1">{label}</td>
                        <td className="py-1 text-right tabular-nums">{o.a}</td>
                        <td className="py-1 text-right tabular-nums">{o.b}</td>
                        <td className="py-1 text-right tabular-nums">{o.shared}</td>
                        <td className={`py-1 text-right font-semibold tabular-nums ${o.jaccard < 0.8 ? "text-amber-700" : "text-emerald-700"}`}>{o.jaccard}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <Section title="Sources de données et versions">
                <table className="w-full text-[13px]">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-3 font-semibold">Source</th>
                      <th className="py-1 pr-3 font-semibold">A</th>
                      <th className="py-1 font-semibold">B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((s) => (
                      <tr key={s.name} className={`border-t border-slate-100 ${s.same_release ? "" : "bg-amber-50"}`}>
                        <td className="py-1 pr-3 font-semibold">{s.name}</td>
                        {[s.a, s.b].map((side, k) => (
                          <td key={k} className="py-1 pr-3 text-slate-700">
                            {side.release ?? "version non communiquée"} · {side.live ?? 0} directe(s), {side.cached ?? 0} du cache
                            {side.oldest_cache && <span className="block text-[11px] text-slate-500">cache du {formatDate(side.oldest_cache)}</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
              <Section title="Étapes du pipeline">
                <table className="w-full text-[13px]">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-3 font-semibold">Étape</th>
                      <th className="py-1 pr-3 font-semibold">A</th>
                      <th className="py-1 font-semibold">B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.steps.map((s) => (
                      <tr key={s.name} className={`border-t border-slate-100 ${s.a.status !== s.b.status ? "bg-amber-50" : ""}`}>
                        <td className="py-1 pr-3">{s.name}</td>
                        <td className="py-1 pr-3">{s.a.status ? `${s.a.status === "succeeded" ? "terminée" : s.a.status} · ${formatDuration(s.a.duration)}` : "absente"}</td>
                        <td className="py-1">{s.b.status ? `${s.b.status === "succeeded" ? "terminée" : s.b.status} · ${formatDuration(s.b.duration)}` : "absente"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            </div>

            <Section title="Environnement de calcul">
              <DiffTable rows={data.environment} onlyDifferences={onlyDifferences} />
            </Section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
