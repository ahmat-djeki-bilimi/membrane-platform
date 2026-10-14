"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight, Dna, FlaskConical, GitCompare, LayoutDashboard, Loader2, Plus, Shapes, Waves, Box, ListOrdered } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import {
  ConservationTab,
  DomainsTab,
  OverviewTab,
  PropertiesTab,
  SequencesTab,
  StructuresTab,
  TopologyTab,
} from "@/components/comparison/ComparisonViews";
import { proteinColor, useComparisonJob } from "@/lib/comparison";
import { downloadText } from "@/lib/sequence";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

type TabKey = "overview" | "sequences" | "structures" | "domains" | "topology" | "conservation" | "properties";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Vue d’ensemble", icon: <LayoutDashboard size={14} /> },
  { key: "sequences", label: "Séquences", icon: <ListOrdered size={14} /> },
  { key: "structures", label: "Structures 3D", icon: <Box size={14} /> },
  { key: "domains", label: "Domaines", icon: <Shapes size={14} /> },
  { key: "topology", label: "Topologie", icon: <Waves size={14} /> },
  { key: "conservation", label: "Conservation", icon: <Dna size={14} /> },
  { key: "properties", label: "Propriétés", icon: <FlaskConical size={14} /> },
];

export default function ComparisonResultPage() {
  return (
    <Suspense fallback={null}>
      <ComparisonResultView />
    </Suspense>
  );
}

function ComparisonResultView() {
  const { job: jobId } = useParams<{ job: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === wanted) ? (wanted as TabKey) : "overview";
  const { status, result, error, job } = useComparisonJob(jobId);
  const wrongKind = !!job?.kind && job.kind !== "protein_comparison";
  const ready = status === "succeeded" && !!result && !wrongKind;
  // Colonne de l'alignement commun sélectionnée, partagée par tous les onglets
  const [column, setColumn] = useState<number | null>(null);

  const openTab = (next: string) => router.replace(`/comparaison/${jobId}?tab=${next}`, { scroll: false });
  const selected = ready && column != null ? result.alignment.columns[column] : null;
  const fileBase = ready ? result.proteins.map((p) => p.accession).join("_") : "comparaison";

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="comparison" />
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-5 lg:px-6">
          <nav className="flex flex-wrap items-center gap-1 text-[13px] text-blue-200">
            <Link href="/" className="hover:text-white">
              Accueil
            </Link>
            <ChevronRight size={12} />
            <Link href="/comparaison" className="hover:text-white">
              Comparaison
            </Link>
          </nav>
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-[26px] font-bold text-white">
                <GitCompare size={24} />
                Comparaison de {ready ? result.proteins.length : (job?.params?.accessions?.length ?? "")} protéines
              </h1>
              {ready && (
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-blue-100">
                  {result.proteins.map((p, k) => (
                    <span key={p.accession} className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: proteinColor(k) }} />
                      <span className="font-mono">{p.accession}</span> {p.gene ?? ""} <span className="italic text-blue-200">{p.organism}</span>
                      {k === result.reference && <span className="text-amber-200">(référence)</span>}
                    </span>
                  ))}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {ready && (
                <button
                  onClick={() =>
                    downloadText(`${fileBase}_alignement.fasta`, result.proteins.map((p, k) => `>${p.accession} ${p.name}\n${result.alignment.rows[k]}`).join("\n") + "\n")
                  }
                  className="rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] font-medium text-white hover:bg-white/20"
                >
                  Alignement (FASTA)
                </button>
              )}
              <Link href="/comparaison" className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-[14px] font-semibold text-[#0f4c81] hover:bg-blue-50">
                <Plus size={14} />
                Nouvelle comparaison
              </Link>
            </div>
          </div>
        </div>
      </section>

      {ready && (
        <div className="sticky top-[var(--site-header-h,62px)] z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex w-full flex-col gap-2 px-4 py-2 lg:px-6">
            <div role="tablist" className="-mx-1 flex gap-1 overflow-x-auto px-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => openTab(t.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[14px] font-semibold transition ${
                    tab === t.key ? "bg-[#0f4c81] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
            {selected && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-violet-50 px-3 py-1.5 text-[13px] text-violet-900">
                <span className="font-semibold">
                  Colonne {column! + 1}
                  {result.alignment.kinds[column!] === "insertion" && " (insertion)"}
                </span>
                {selected.map((residue, p) => (
                  <span key={p} className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: proteinColor(p) }} />
                    <span className="font-mono">
                      {result.proteins[p].accession} {residue ? `${result.alignment.rows[p][column!]}${residue}` : "—"}
                    </span>
                  </span>
                ))}
                <button onClick={() => setColumn(null)} className="ml-auto font-semibold hover:underline">
                  Désélectionner
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="w-full flex-1 space-y-4 px-4 py-4 lg:px-6">
        {!ready && <Progress status={wrongKind ? "failed" : status} error={wrongKind ? "Cette adresse ne correspond pas à une comparaison." : error} />}
        {ready && tab === "overview" && <OverviewTab result={result} onTab={openTab} />}
        {ready && tab === "sequences" && <SequencesTab result={result} column={column} onColumn={setColumn} />}
        {ready && tab === "structures" && <StructuresTab result={result} column={column} onColumn={setColumn} />}
        {ready && tab === "domains" && <DomainsTab result={result} column={column} onColumn={setColumn} />}
        {ready && tab === "topology" && <TopologyTab result={result} column={column} onColumn={setColumn} />}
        {ready && tab === "conservation" && <ConservationTab result={result} column={column} onColumn={setColumn} />}
        {ready && tab === "properties" && <PropertiesTab result={result} column={column} onColumn={setColumn} />}
        {ready && (
          <p className="text-[12px] leading-5 text-slate-500">
            Méthodes : {result.method.alignment}. {result.method.structure}. {result.method.reliability}.
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function Progress({ status, error }: { status: string; error: string | null }) {
  if (status === "failed") {
    return (
      <section className="rounded-lg border border-rose-200 bg-white p-5">
        <p className="flex items-start gap-2 text-[15px] text-rose-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          Comparaison impossible : {error}
        </p>
        <Link href="/comparaison" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-blue-700 hover:underline">
          <Plus size={14} />
          Nouvelle comparaison
        </Link>
      </section>
    );
  }
  return (
    <section className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
      <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-cyan-600" />
      <div>
        <p className="font-semibold text-slate-900">{status === "running" ? "Comparaison en cours…" : "Comparaison en file d’attente…"}</p>
        <p className="text-[14px]">Alignements deux à deux, modèles AlphaFold et superpositions : quelques secondes. Gardez l’adresse de cette page : le résultat y sera conservé.</p>
      </div>
    </section>
  );
}
