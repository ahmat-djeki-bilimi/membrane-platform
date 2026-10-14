"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Compass,
  Dna,
  Download,
  GitBranch,
  LayoutDashboard,
  Loader2,
  Map as MapIcon,
  Network,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { StatCard } from "@/components/ui";
import CartographyTab from "@/components/explorer/CartographyTab";
import CoevolutionTab from "@/components/explorer/CoevolutionTab";
import ConservationTab from "@/components/explorer/ConservationTab";
import PhylogenyTab from "@/components/explorer/PhylogenyTab";
import HomologsTab from "@/components/explorer/HomologsTab";
import TopologyTab from "@/components/explorer/TopologyTab";
import { EXPLORER_VERSION, alignmentFasta, submitExplorer, useExplorerJob, type ExplorerResult, type QualityParams } from "@/lib/explorer";
import RerunNotice from "@/components/explorer/RerunNotice";
import { downloadText } from "@/lib/sequence";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

type TabKey = "overview" | "homologues" | "conservation" | "phylogenie" | "topologie" | "cartographie" | "coevolution";

const TABS: { key: TabKey; label: string; icon: React.ReactNode; text: string }[] = [
  { key: "overview", label: "Vue d’ensemble", icon: <LayoutDashboard size={14} />, text: "" },
  { key: "homologues", label: "Homologues", icon: <Users size={14} />, text: "Filtres, regroupement des séquences proches, diversité taxonomique et choix des homologues analysés" },
  { key: "conservation", label: "Conservation", icon: <Dna size={14} />, text: "Contrôle qualité de l’alignement, positions conservées et variables" },
  { key: "phylogenie", label: "Phylogénie", icon: <GitBranch size={14} />, text: "Arbre phylogénétique de la référence et de ses homologues" },
  { key: "topologie", label: "Topologie", icon: <Compass size={14} />, text: "Segments TM comparés (DeepTMHMM · UniProt · structure 3D) et orientation calculée" },
  { key: "cartographie", label: "Cartographie", icon: <MapIcon size={14} />, text: "Carte 3D des résidus et positions candidates" },
  { key: "coevolution", label: "Coévolution", icon: <Network size={14} />, text: "Paires de résidus corrélées et réseaux" },
];

/** Résultats d'une analyse de l'explorateur, un onglet par étape (comme la page d'une protéine). */
export default function ExplorerResultPage() {
  // useSearchParams exige une frontière Suspense
  return (
    <Suspense fallback={null}>
      <ExplorerResult />
    </Suspense>
  );
}

function ExplorerResult() {
  const { job: jobId } = useParams<{ job: string }>();
  const router = useRouter();
  const params = useSearchParams();
  // Onglet demandé dans l'adresse (?tab=coevolution…)
  const wanted = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === wanted) ? (wanted as TabKey) : "overview";
  const [selected, setSelected] = useState<number | null>(null);
  const { status, result, error, job } = useExplorerJob(jobId);
  const wrongKind = !!job?.kind && job.kind !== "explorer";
  const ready = status === "succeeded" && !!result && !wrongKind;

  const openTab = (next: TabKey) => router.replace(`/explorateur/${jobId}?tab=${next}`, { scroll: false });

  // Même analyse relancée avec la méthode actuelle (nouvelle tâche, même onglet)
  const jobParams = job?.params;
  // Mêmes séquences : la sélection d'homologues et le contrôle qualité sont gardés sauf s'ils sont remplacés
  const submit = async (change: { keep?: string[] | null; qc?: QualityParams | null }, nextTab: TabKey) => {
    const next = await submitExplorer({
      fasta: jobParams!.fasta!,
      reference: jobParams!.reference ?? 0,
      accession: jobParams!.accession ?? null,
      expand: !!jobParams!.expand,
      keep: "keep" in change ? change.keep : (jobParams!.keep ?? null),
      qc: "qc" in change ? change.qc : (jobParams!.qc ?? null),
    });
    router.push(`/explorateur/${next.id}?tab=${nextTab}`);
  };
  const rerun = jobParams?.fasta ? () => submit({}, tab) : undefined;
  // Homologues choisis dans l'onglet Homologues : nouvelle analyse
  const applySelection = jobParams?.fasta ? (keep: string[] | null) => submit({ keep }, "conservation") : undefined;
  // Filtres du contrôle qualité (onglet Conservation) : nouvelle analyse
  const applyQuality = jobParams?.fasta ? (qc: QualityParams | null) => submit({ qc }, "conservation") : undefined;

  const select = (position: number) => setSelected((current) => (current === position ? null : position));
  const fileBase = result ? (result.reference.accession ?? result.reference.id).replace(/[^\w.-]+/g, "_") : "analyse";
  const selectedPosition = ready && selected ? result.positions[selected - 1] : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="explorer" />

      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-5 lg:px-6">
          <nav className="flex flex-wrap items-center gap-1 text-[13px] text-blue-200">
            <Link href="/" className="hover:text-white">
              Accueil
            </Link>
            <ChevronRight size={12} />
            <Link href="/explorateur" className="hover:text-white">
              Explorateur
            </Link>
            {ready && (
              <>
                <ChevronRight size={12} />
                <span className="font-mono text-cyan-200">{result.reference.accession ?? result.reference.id}</span>
              </>
            )}
          </nav>
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-[13px] font-semibold text-white">
                <Sparkles size={13} />
                Membrane Evolution &amp; Function Explorer
              </span>
              <h1 className="mt-1.5 truncate text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">
                {ready ? result.reference.protein_name || result.reference.id : "Analyse de la famille"}
              </h1>
              {ready && (
                <p className="text-[15px] text-blue-100">
                  {result.reference.organism && <span className="italic">{result.reference.organism}</span>}
                  {result.reference.organism ? " · " : ""}
                  {result.reference.length} résidus · famille de {result.input.kept + 1} séquences
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {ready && (
                <button
                  onClick={() => downloadText(`${fileBase}_alignement.fasta`, alignmentFasta(result))}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] font-medium text-white hover:bg-white/20"
                >
                  <Download size={14} />
                  Alignement (FASTA)
                </button>
              )}
              {ready && result.reference.accession && (
                <Link
                  href={`/structures/${result.reference.accession}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] font-medium text-white hover:bg-white/20"
                >
                  Fiche {result.reference.accession}
                </Link>
              )}
              <Link
                href="/explorateur"
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-[14px] font-semibold text-[#0f4c81] hover:bg-blue-50"
              >
                <Plus size={14} />
                Nouvelle analyse
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
            {selectedPosition && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-violet-50 px-3 py-1.5 text-[13px] text-violet-900">
                <span className="font-mono text-[14px] font-bold">
                  {selectedPosition.residue}
                  {selectedPosition.position}
                </span>
                <span>grade {selectedPosition.grade}/9</span>
                {selectedPosition.region && <span>{selectedPosition.region}</span>}
                {selectedPosition.z != null && <span>z = {selectedPosition.z} Å</span>}
                {selectedPosition.burial && <span>{selectedPosition.burial}</span>}
                {selectedPosition.couplings > 0 && <span>{selectedPosition.couplings} couplage(s) MIp</span>}
                {selectedPosition.sector && <span>secteur SCA {selectedPosition.sector}</span>}
                {selectedPosition.top_residues.length > 0 && (
                  <span>
                    acides aminés : {selectedPosition.top_residues.map((r) => `${r.residue} ${Math.round(r.frequency * 100)} %`).join(", ")}
                  </span>
                )}
                <button onClick={() => setSelected(null)} className="ml-auto font-semibold hover:underline">
                  Désélectionner
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="w-full flex-1 space-y-4 px-4 py-4 lg:px-6">
        {!ready && (
          <Progress
            status={wrongKind ? "failed" : status}
            error={wrongKind ? "Cette adresse ne correspond pas à une analyse de l’explorateur." : error}
            expand={!!job?.params?.expand}
          />
        )}

        {ready && result.version < EXPLORER_VERSION && rerun && (
          <RerunNotice
            compact
            title="Analyse calculée par une version précédente."
            text="Certains résultats récents manquent (arbre phylogénétique, E-values, secteurs SCA…)."
            onRerun={rerun}
          />
        )}

        {ready && tab === "overview" && <Overview result={result} onOpen={openTab} />}
        {ready && tab === "homologues" && <HomologsTab result={result} onApply={applySelection} />}
        {ready && tab === "conservation" && <ConservationTab
            result={result}
            selected={selected}
            onSelect={select}
            quality={jobParams?.qc ?? null}
            onApplyQuality={applyQuality}
            fileBase={fileBase}
          />}
        {ready && tab === "phylogenie" && <PhylogenyTab result={result} jobId={jobId} fileBase={fileBase} onRerun={rerun} />}
        {ready && tab === "topologie" && <TopologyTab result={result} selected={selected} onSelect={select} />}
        {ready && tab === "cartographie" && <CartographyTab result={result} selected={selected} onSelect={select} fileBase={fileBase} />}
        {ready && tab === "coevolution" && <CoevolutionTab result={result} selected={selected} onSelect={select} fileBase={fileBase} onRerun={rerun} />}
      </main>

      <SiteFooter />
    </div>
  );
}

function Progress({ status, error, expand }: { status: string; error: string | null; expand: boolean }) {
  if (status === "failed") {
    return (
      <section className="rounded-lg border border-rose-200 bg-white p-5">
        <p className="flex items-start gap-2 text-[15px] text-rose-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          Analyse impossible : {error}
        </p>
        <Link href="/explorateur" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-blue-700 hover:underline">
          <Plus size={14} />
          Nouvelle analyse
        </Link>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3 text-slate-600">
        <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-cyan-600" />
        <div>
          <p className="font-semibold text-slate-900">{status === "running" ? "Analyse en cours…" : "Analyse en file d’attente…"}</p>
          <p className="text-[14px]">
            {expand
              ? "Recherche d’homologues MMseqs2 (1 à 5 minutes), alignement, structure placée dans la membrane, coévolution."
              : "Alignement, conservation, structure placée dans la membrane et coévolution : de quelques secondes à une minute."}{" "}
            Vous pouvez garder l’adresse de cette page : le résultat y sera conservé.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Vue d'ensemble : chiffres clés, synthèse et accès aux autres onglets. */
function Overview({ result, onOpen }: { result: ExplorerResult; onOpen: (tab: TabKey) => void }) {
  const coevolution = result.coevolution;
  const functional = result.candidates.filter((c) => c.category === "Fonctionnel").length;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          tone="blue"
          icon={<Users size={16} />}
          label="Homologues"
          value={`${result.input.kept}`}
          hint={
            result.input.selection
              ? `sélectionnés parmi ${result.input.pool}`
              : result.input.expanded
                ? `dont ${result.input.mmseqs_added} ajoutés par MMseqs2`
                : `${result.input.excluded.length} séquence(s) écartée(s)`
          }
        />
        <StatCard
          tone="amber"
          icon={<Compass size={16} />}
          label="Segments TM"
          value={`${result.topology.segments.length}`}
          hint={result.structure ? `modèle ${result.structure.source}${result.structure.membrane ? `, bicouche calculée de ${result.structure.membrane.thickness} Å` : ""}` : "aucune structure 3D"}
        />
        <StatCard tone="rose" icon={<ShieldCheck size={16} />} label="Positions candidates" value={`${result.candidates.length}`} hint={`dont ${functional} fonctionnelle(s) probable(s)`} />
        <StatCard
          tone="emerald"
          icon={<Network size={16} />}
          label="Coévolution"
          value={coevolution ? coevolution.reliability.level : "—"}
          hint={coevolution ? `Neff ${coevolution.neff} · ${result.networks.length} réseau(x)` : "non calculée"}
        />
      </section>

      {result.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {w}
        </p>
      ))}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-[16px] font-semibold text-slate-900">Synthèse</h2>
        <ul className="mt-2 grid gap-2 lg:grid-cols-2">
          {result.interpretation.map((note) => (
            <li key={note.topic} className="rounded-md bg-slate-50 px-3 py-2 text-[14px] leading-5 text-slate-700">
              <b className="text-slate-900">{note.title}.</b> {note.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-[16px] font-semibold text-slate-900">Positions candidates en tête</h2>
        <p className="mb-2 text-[13px] text-slate-500">Le détail et la carte 3D sont dans l’onglet Cartographie.</p>
        <div className="flex flex-wrap gap-1.5">
          {result.candidates.slice(0, 12).map((c) => (
            <span key={c.position} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[13px] font-semibold text-slate-800" title={c.reasons.join(" · ")}>
              {c.residue}
              {c.position} <span className="font-sans font-normal text-slate-500">{c.category.toLowerCase()}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {TABS.filter((t) => t.key !== "overview").map((t) => (
          <button
            key={t.key}
            onClick={() => onOpen(t.key)}
            className="group rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-[#0f4c81]"
          >
            <span className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-900">
              {t.icon}
              {t.label}
              <ArrowRight size={14} className="ml-auto text-slate-400 group-hover:text-[#0f4c81]" />
            </span>
            <span className="mt-1 block text-[13px] leading-5 text-slate-500">{t.text}</span>
          </button>
        ))}
      </section>
    </>
  );
}
