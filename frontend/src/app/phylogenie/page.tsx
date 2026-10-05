"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, GitBranch, Layers, Loader2, ShieldCheck, Users } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { SEQUENCE_STORAGE_PREFIX } from "@/components/SearchForm";
import { SegmentedControl, StatCard } from "@/components/ui";
import MsaViewer from "@/components/evolution/MsaViewer";
import PhyloTree from "@/components/evolution/PhyloTree";
import { API_BASE } from "@/lib/api";
import {
  useConservation,
  useSequenceConservation,
  type ConservationSource,
  type PhyloNode,
} from "@/lib/conservation";
import { layoutTree } from "@/lib/phylo";
import type { ParsedSequence } from "@/lib/sequence";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

export default function PhylogenyPage() {
  // useSearchParams exige une frontière Suspense pour le rendu statique (next build)
  return (
    <Suspense fallback={null}>
      <PhylogenyContent />
    </Suspense>
  );
}

function PhylogenyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const accession = params.get("accession")?.toUpperCase().trim() || null;
  const seqId = params.get("seq");
  const source: ConservationSource = params.get("source") === "mmseqs" ? "mmseqs" : "uniref50";

  const [submitted, setSubmitted] = useState<ParsedSequence | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [protein, setProtein] = useState<{ name: string; organism: string | null } | null>(null);
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);

  // Séquence collée : relue depuis la session du navigateur
  useEffect(() => {
    if (accession || !seqId) return;
    try {
      const stored = sessionStorage.getItem(SEQUENCE_STORAGE_PREFIX + seqId);
      if (stored) setSubmitted(JSON.parse(stored));
      else setStorageError("Cette séquence n’est plus disponible dans la session du navigateur. Collez-la à nouveau dans la page Recherche.");
    } catch {
      setStorageError("Impossible de relire la séquence enregistrée dans ce navigateur.");
    }
  }, [accession, seqId]);

  useEffect(() => {
    if (!accession) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/uniprot/${accession}`)
      .then((r) => r.json())
      .then((d) => !cancelled && d.available && setProtein({ name: d.protein_name, organism: d.organism }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accession]);

  const name = submitted?.header || "Séquence soumise";
  const byAccession = useConservation(accession, source);
  const bySequence = useSequenceConservation(accession ? null : submitted?.sequence, name);
  const { status, result, error, matched } = accession ? byAccession : bySequence;
  const tree = result?.tree ?? null;

  const treeOrder = useMemo(() => {
    if (!tree) return undefined;
    return layoutTree(tree.root, "cladogram").order.map((i) => tree.leaves[i]?.id).filter((id): id is string => !!id);
  }, [tree]);

  const supports = useMemo(() => {
    const values: number[] = [];
    const walk = (node: PhyloNode) => {
      if (node.support !== undefined && node.support !== null) values.push(node.support);
      node.children?.forEach(walk);
    };
    if (tree) walk(tree.root);
    return values;
  }, [tree]);

  const title = accession ? protein?.name ?? accession : name;
  const backHref = accession ? `/structures/${accession}?tab=evolution` : seqId ? `/search?seq=${seqId}` : "/search";
  const fileBase = accession ?? (name.replace(/[^\w.-]+/g, "_") || "sequence");
  const lowestIdentity = tree
    ? Math.min(...tree.leaves.filter((l) => !l.is_query && l.identity !== null).map((l) => l.identity!))
    : null;

  const setSource = (next: ConservationSource) => {
    const query = new URLSearchParams(params.toString());
    query.set("source", next);
    router.replace(`/phylogenie?${query.toString()}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader />

      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-5 lg:px-6">
          <nav className="flex flex-wrap items-center gap-1 text-[13px] text-blue-200">
            <Link href="/" className="hover:text-white">
              Accueil
            </Link>
            <ChevronRight size={12} />
            <Link href={backHref} className="hover:text-white">
              {accession ? "Structures" : "Analyse de séquence"}
            </Link>
            <ChevronRight size={12} />
            <span className="text-white">Phylogénie</span>
            {accession && (
              <>
                <ChevronRight size={12} />
                <span className="font-mono text-cyan-200">{accession}</span>
              </>
            )}
          </nav>

          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-[13px] font-semibold text-white">
                  <GitBranch size={13} />
                  Arbre phylogénétique
                </span>
                {accession && (
                  <span className="rounded bg-cyan-400/20 px-2 py-0.5 font-mono text-[13px] font-semibold text-cyan-100">
                    {accession}
                  </span>
                )}
              </div>
              <h1 className="mt-1.5 truncate text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">
                {title}
              </h1>
              <p className="text-[15px] text-blue-100">
                {protein?.organism ? <span className="italic">{protein.organism}</span> : null}
                {protein?.organism ? " · " : ""}
                Histoire évolutive de la protéine et de ses homologues
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {accession && (
                <div className="rounded-md bg-white p-0.5">
                  <SegmentedControl
                    label="Source des homologues"
                    value={source}
                    onChange={setSource}
                    options={[
                      { value: "uniref50", label: "Orthologues proches", title: "UniRef50 : séquences à au moins 50 % d’identité, rapide" },
                      { value: "mmseqs", label: "Recherche étendue", title: "MMseqs2 : homologues plus lointains" },
                    ]}
                  />
                </div>
              )}
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] font-medium text-white hover:bg-white/20"
              >
                <ArrowLeft size={14} />
                {accession ? "Conservation" : "Analyse de séquence"}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <main className="flex w-full flex-1 flex-col gap-4 px-4 py-4 lg:px-6">
        {!accession && !seqId && (
          <Message>
            Ouvrez cette page depuis l’onglet Évolution d’une protéine ou depuis l’analyse d’une séquence.
          </Message>
        )}
        {storageError && <Message>{storageError}</Message>}

        {(accession || submitted) && status !== "succeeded" && (
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            {status === "failed" ? (
              <p className="text-[15px] text-red-700">{error || "Calcul impossible."}</p>
            ) : (
              <div className="flex items-start gap-3 text-slate-600">
                <Loader2 size={20} className="mt-0.5 animate-spin text-cyan-600" />
                <div>
                  <p className="font-semibold text-slate-900">Recherche des homologues et construction de l’arbre…</p>
                  <p className="text-[14px]">
                    {accession && source === "uniref50"
                      ? "Quelques secondes."
                      : "De 20 secondes à quelques minutes selon la charge du serveur MMseqs2."}{" "}
                    Le résultat est ensuite conservé.
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {matched && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[14px] text-emerald-900">
            <span>
              Séquence identique à l’entrée UniProt <span className="font-mono font-semibold">{matched.accession}</span>
              {matched.reviewed ? " (Swiss-Prot)" : ""} : l’arbre porte sur ses orthologues.
            </span>
          </div>
        )}

        {status === "succeeded" && result && !tree && (
          <Message>
            Pas assez d’homologues pour construire un arbre (4 séquences au minimum). Essayez la recherche étendue.
          </Message>
        )}

        {tree && result && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                tone="violet"
                icon={<GitBranch size={15} />}
                label="Séquences"
                value={`${tree.leaf_count}`}
                hint={result.source === "mmseqs" ? "homologues MMseqs2 les plus proches" : "orthologues UniRef50, une par espèce"}
              />
              <StatCard
                tone="blue"
                icon={<Users size={15} />}
                label={tree.group_rank_label ? `Groupes (${tree.group_rank_label.toLowerCase()})` : "Groupes"}
                value={`${tree.groups.length}`}
                hint={tree.groups.slice(0, 3).map((g) => g.name).join(", ") || "taxonomie inconnue"}
              />
              <StatCard
                tone="emerald"
                icon={<ShieldCheck size={15} />}
                label="Branches robustes"
                value={supports.length ? `${supports.filter((s) => s >= 0.7).length} / ${supports.length}` : "—"}
                hint={`bootstrap ≥ 70 % sur ${tree.bootstrap_replicates} réplicats`}
              />
              <StatCard
                tone="amber"
                icon={<Layers size={15} />}
                label="Identité la plus faible"
                value={lowestIdentity !== null && Number.isFinite(lowestIdentity) ? `${Math.round(lowestIdentity * 100)} %` : "—"}
                hint="homologue le plus éloigné de la protéine étudiée"
              />
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <PhyloTree
                tree={tree}
                selectedId={selectedSpecies}
                onSelect={setSelectedSpecies}
                fileBase={fileBase}
                maxHeight={900}
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-[16px] font-semibold text-slate-900">Alignement dans l’ordre de l’arbre</h2>
              <p className="mb-3 text-[14px] text-slate-600">
                Les espèces proches se suivent : les substitutions partagées par un groupe apparaissent en bloc.
                Cliquer sur une espèce dans l’arbre ou ici la surligne des deux côtés.
              </p>
              <MsaViewer
                query={result.query_sequence}
                rows={result.msa}
                positions={result.positions}
                regions={result.summary.regions}
                treeOrder={treeOrder}
                highlightId={selectedSpecies}
                onSelectRow={setSelectedSpecies}
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-[14px] leading-6 text-slate-600">
              <h2 className="mb-1 text-[16px] font-semibold text-slate-900">Méthode et lecture</h2>
              <p>
                Distances entre séquences : proportion d’acides aminés différents sur les positions alignées, corrigée par
                la formule de Kimura (1983). Arbre par Neighbor-Joining (Saitou &amp; Nei, 1987), raciné au milieu du plus
                long chemin entre deux espèces : cette racine est une approximation, pas forcément l’ancêtre réel. Le
                bootstrap (Felsenstein, 1985) rééchantillonne {tree.bootstrap_replicates} fois les colonnes de
                l’alignement : un embranchement retrouvé dans au moins 70 % des réplicats est considéré comme robuste.
                Dans un arbre de gènes, une espèce mal placée peut signaler une duplication (paralogue) ou une séquence
                incomplète.
              </p>
            </section>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-slate-200 bg-white p-4 text-[15px] text-slate-700">{children}</p>;
}
