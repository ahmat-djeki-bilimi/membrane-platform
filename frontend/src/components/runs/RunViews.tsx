"use client";

import { AlertTriangle, CheckCircle2, Clock, Database, Download, FileJson, FileSpreadsheet, FileText, Loader2, XCircle } from "lucide-react";
import { STATUS_LABELS, csvUrl, formatDate, formatDuration, jsonUrl, reportUrl, type Run, type RunSource, type RunStep } from "@/lib/runs";

export function StatusBadge({ status, stale = false }: { status: string; stale?: boolean }) {
  if (stale)
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[12px] font-semibold text-amber-900">
        <AlertTriangle size={12} /> Probablement interrompue
      </span>
    );
  const tone =
    status === "succeeded" ? "bg-emerald-50 text-emerald-800" : status === "failed" ? "bg-rose-50 text-rose-800" : "bg-sky-50 text-sky-800";
  const icon =
    status === "succeeded" ? <CheckCircle2 size={12} /> : status === "failed" ? <XCircle size={12} /> : status === "running" ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ${tone}`}>
      {icon}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Section({ title, subtitle, children, right }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-[13px] text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Étapes du pipeline : statut, durée relative, réutilisation du cache, erreur. */
export function StepsTimeline({ steps }: { steps: RunStep[] }) {
  if (!steps.length) return <p className="text-[14px] text-slate-500">Étapes non enregistrées (exécution antérieure à la traçabilité, ou encore en file d’attente).</p>;
  const longest = Math.max(...steps.map((s) => s.duration ?? 0), 0.001);
  return (
    <ol className="space-y-1.5">
      {steps.map((step, k) => (
        <li key={k} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
          <span
            className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${
              step.status === "succeeded" ? "bg-emerald-600" : step.status === "failed" ? "bg-rose-600" : "bg-sky-600"
            }`}
          >
            {k + 1}
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2 text-[14px]">
              <span className="font-semibold text-slate-900">{step.name}</span>
              {step.detail && <span className="text-slate-500">{step.detail}</span>}
              <StatusBadge status={step.status} />
              <span className="tabular-nums text-[12px] text-slate-500">{formatDuration(step.duration)}</span>
              {step.cache_hits > 0 && <span className="rounded bg-slate-100 px-1.5 text-[12px] text-slate-600">{step.cache_hits} réponse(s) relue(s) du cache</span>}
            </p>
            <div className="mt-0.5 h-1.5 rounded bg-slate-100">
              <div className={`h-1.5 rounded ${step.status === "failed" ? "bg-rose-500" : "bg-[#0f4c81]"}`} style={{ width: `${Math.max(((step.duration ?? 0) / longest) * 100, 1)}%` }} />
            </div>
            {step.error && <p className="mt-0.5 text-[13px] text-rose-700">{step.error}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SourcesTable({ sources }: { sources: RunSource[] }) {
  if (!sources.length) return <p className="text-[14px] text-slate-500">Aucune source externe enregistrée.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-3 font-semibold">Source</th>
            <th className="py-1 pr-3 font-semibold">Version (release)</th>
            <th className="py-1 pr-3 text-right font-semibold">Requêtes directes</th>
            <th className="py-1 pr-3 text-right font-semibold">Réponses du cache</th>
            <th className="py-1 pr-3 font-semibold">Cache le plus ancien</th>
            <th className="py-1 font-semibold">Échecs</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.name} className="border-t border-slate-100">
              <td className="py-1 pr-3 font-semibold">
                <Database size={12} className="mr-1 inline text-slate-400" />
                {s.name}
              </td>
              <td className="py-1 pr-3">{s.release ? `${s.release}${s.release_date ? ` (${s.release_date})` : ""}` : <span className="text-slate-400">non communiquée</span>}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{s.live_requests}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{s.cached_responses}</td>
              <td className="py-1 pr-3">{s.oldest_cache ? formatDate(s.oldest_cache) : "—"}</td>
              <td className={`py-1 ${s.failed_requests ? "text-rose-700" : "text-slate-400"}`} title={s.last_error ?? undefined}>
                {s.failed_requests ? `${s.failed_requests} (${(s.last_error ?? "").slice(0, 60)})` : "0"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-slate-500">
        Une réponse du cache reflète la base à la date de mise en cache. La version n’est connue que si le service la communique (UniProt) lors
        d’une requête directe.
      </p>
    </div>
  );
}

export function InputsList({ run }: { run: Run }) {
  // Entrées déclarées et entrées enregistrées pendant le calcul : une seule ligne par (type, identifiant)
  const merged = new Map<string, Run["inputs"][number]>();
  for (const input of [...run.inputs, ...(run.provenance?.inputs ?? [])]) {
    const key = `${input.kind}|${input.id}`;
    merged.set(key, { ...merged.get(key), ...input });
  }
  const all = [...merged.values()];
  if (!all.length) return <p className="text-[14px] text-slate-500">Aucune entrée déclarée.</p>;
  return (
    <ul className="space-y-1 text-[13px]">
      {all.map((input, k) => (
        <li key={k}>
          <span className="text-slate-500">{input.kind} :</span> <span className="font-mono font-semibold">{input.id}</span>{" "}
          <span className="text-slate-500">
            {Object.entries(input)
              .filter(([key]) => key !== "kind" && key !== "id")
              .map(([key, value]) => `${key} ${value}`)
              .join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Exports({ run }: { run: Run }) {
  const link = "inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a href={reportUrl(run.id)} className="inline-flex items-center gap-1.5 rounded-md bg-[#0f4c81] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#0c3d68]">
          <FileText size={14} />
          Rapport scientifique (PDF)
        </a>
        <a href={jsonUrl(run.id)} className={link}>
          <FileJson size={14} />
          Données complètes (JSON)
        </a>
      </div>
      {run.tables && (
        <div>
          <p className="text-[13px] font-semibold text-slate-700">Tableaux (CSV, séparateur « ; »)</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(run.tables).map(([table, label]) => (
              <a key={table} href={csvUrl(run.id, table)} className={link}>
                <FileSpreadsheet size={14} />
                {label}
              </a>
            ))}
          </div>
        </div>
      )}
      <p className="text-[12px] text-slate-500">
        <Download size={12} className="mr-1 inline" />
        Le rapport reprend les entrées, les versions des sources, les méthodes et références, les paramètres, les étapes, les résultats
        principaux, les avertissements et les erreurs. Le JSON contient tout, y compris le résultat complet.
      </p>
    </div>
  );
}
