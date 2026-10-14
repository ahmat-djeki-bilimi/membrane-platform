"use client";

import Link from "next/link";
import MiniProteinViewer from "../components/MiniProteinViewer";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import SearchForm from "../components/SearchForm";
import SequencePaste from "../components/SequencePaste";
import { HERO_BG, HERO_GLOW, TONES, type Tone } from "../lib/theme";
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Boxes,
  Compass,
  Crosshair,
  Database,
  Dna,
  FileText,
  GitBranch,
  GitCompare,
  Layers3,
  Network,
  Puzzle,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
} from "lucide-react";

const FEATURED = [
  {
    pdbId: "1C3W",
    tone: "violet" as Tone,
    name: "Bactériorhodopsine",
    organism: "Halobacterium salinarum",
    family: "Pompe à protons · 7 hélices TM",
  },
  {
    pdbId: "1BL8",
    tone: "emerald" as Tone,
    name: "Canal potassique KcsA",
    organism: "Streptomyces lividans",
    family: "Canal ionique · tétramère",
  },
  {
    pdbId: "1J4N",
    tone: "cyan" as Tone,
    name: "Aquaporine-1",
    organism: "Bos taurus",
    family: "Canal hydrique · 6 hélices TM",
  },
];

// Les grands modules de la plateforme, chacun avec sa couleur
const MODULES: {
  href: string;
  icon: React.ReactNode;
  tone: Tone;
  glow: string;
  title: string;
  text: string;
  points: string[];
}[] = [
  {
    href: "/search",
    icon: <Search size={20} />,
    tone: "blue",
    glow: "from-blue-500/20",
    title: "Recherche",
    text: "Une accession UniProt ou une séquence suffit pour démarrer.",
    points: ["Annotation fonctionnelle", "Topologie DeepTMHMM", "Physico-chimie et motifs"],
  },
  {
    href: "/structures/P02945",
    icon: <Boxes size={20} />,
    tone: "violet",
    glow: "from-violet-500/20",
    title: "Structures 3D",
    text: "Structures PDB et modèles AlphaFold, validés et orientés dans la membrane.",
    points: ["Qualité et pLDDT", "Domaines et site actif", "Orientation OPM"],
  },
  {
    href: "/explorateur",
    icon: <Sparkles size={20} />,
    tone: "emerald",
    glow: "from-emerald-500/20",
    title: "Explorateur évolutif",
    text: "Famille d’homologues : conservation, phylogénie et coévolution.",
    points: ["Contrôle de l’alignement", "Arbres NJ et IQ-TREE", "Coévolution MIp / SCA"],
  },
  {
    href: "/comparaison",
    icon: <GitCompare size={20} />,
    tone: "amber",
    glow: "from-amber-500/20",
    title: "Comparaison",
    text: "Plusieurs protéines côte à côte, de la séquence à la structure.",
    points: ["Identité et couverture", "Topologies alignées", "Superposition 3D"],
  },
  {
    href: "/structures/P02945?tab=mutations",
    icon: <ArrowLeftRight size={20} />,
    tone: "rose",
    glow: "from-rose-500/20",
    title: "Mutations",
    text: "Situer une substitution dans la structure, la membrane et la conservation.",
    points: ["Contexte structural", "Variants connus", "Aucune conclusion hâtive"],
  },
  {
    href: "/analyses",
    icon: <FileText size={20} />,
    tone: "cyan",
    glow: "from-cyan-500/20",
    title: "Analyses et rapports",
    text: "Chaque calcul est tracé, reproductible et exportable.",
    points: ["Paramètres et versions", "Relance et comparaison", "Rapport téléchargeable"],
  },
];

const PIPELINE = [
  {
    icon: <Database size={18} />,
    source: "UniProtKB",
    tone: "blue" as Tone,
    title: "Annotation",
    text: "Séquence, organisme, gènes et fonction de la protéine.",
  },
  {
    icon: <Activity size={18} />,
    source: "DeepTMHMM",
    tone: "emerald" as Tone,
    title: "Détection membranaire",
    text: "Segments transmembranaires, topologie et type de protéine.",
  },
  {
    icon: <Boxes size={18} />,
    source: "RCSB PDB",
    tone: "violet" as Tone,
    title: "Structures expérimentales",
    text: "Sélection des entrées par méthode et résolution.",
  },
  {
    icon: <Layers3 size={18} />,
    source: "AlphaFold DB",
    tone: "amber" as Tone,
    title: "Prédiction",
    text: "Modèle prédit utilisé en l’absence de structure expérimentale.",
  },
  {
    icon: <ShieldCheck size={18} />,
    source: "ERRAT · OPM",
    tone: "rose" as Tone,
    title: "Validation",
    text: "Qualité du modèle et orientation dans la bicouche lipidique.",
  },
];

const ANALYSES = [
  { icon: <Activity size={18} />, title: "Topologie transmembranaire", tone: "emerald" as Tone, text: "Segments TM sur la séquence et la structure 3D, orientation N/C-terminale." },
  { icon: <Compass size={18} />, title: "Orientation membranaire", tone: "cyan" as Tone, text: "Position et inclinaison de la protéine dans la bicouche (OPM)." },
  { icon: <Puzzle size={18} />, title: "Domaines structuraux", tone: "violet" as Tone, text: "Domaines InterPro, Pfam et CATH positionnés sur la structure." },
  { icon: <BarChart3 size={18} />, title: "Qualité structurale", tone: "amber" as Tone, text: "ERRAT, Ramachandran, clashscore et pLDDT par résidu." },
  { icon: <Crosshair size={18} />, title: "Site actif", tone: "rose" as Tone, text: "Résidus catalytiques et sites de liaison, poches candidates." },
  { icon: <Tags size={18} />, title: "Annotation fonctionnelle", tone: "blue" as Tone, text: "Gene Ontology et sites, preuves expérimentales séparées des prédictions." },
  { icon: <Dna size={18} />, title: "Conservation évolutive", tone: "emerald" as Tone, text: "Scores par position avec contrôle de qualité de l’alignement." },
  { icon: <GitBranch size={18} />, title: "Phylogénie", tone: "violet" as Tone, text: "Neighbor-Joining rapide ou maximum de vraisemblance avec IQ-TREE." },
  { icon: <Network size={18} />, title: "Coévolution", tone: "cyan" as Tone, text: "Paires de résidus couplés (MIp, SCA) avec contrôle de fiabilité." },
];

const HIGHLIGHTS = [
  { value: "6", label: "sources de données" },
  { value: "10", label: "vues par structure" },
  { value: "ML", label: "phylogénie IQ-TREE" },
  { value: "100 %", label: "analyses traçables" },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col app-bg text-slate-900">
      <SiteHeader active="home" />

      {/* Bandeau principal */}
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div aria-hidden className="pointer-events-none absolute -left-24 top-10 -z-10 h-72 w-72 animate-float rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-10 bottom-0 -z-10 h-80 w-80 animate-float rounded-full bg-cyan-400/20 blur-3xl [animation-delay:-4s]" />

        <div className="relative grid w-full gap-10 px-4 py-10 lg:grid-cols-[1.2fr_1fr] lg:px-8 lg:py-14">
          <div className="flex animate-fade-up flex-col justify-center">
            <p className="glass-dark inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-1 text-[12.5px] font-bold uppercase tracking-[0.16em] text-cyan-100">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Plateforme bioinformatique
            </p>
            <h1 className="mt-4 text-[36px] font-extrabold leading-[1.08] tracking-tight text-white sm:text-[50px]">
              Détecter, prédire et interpréter
              <span className="gradient-text-light block pb-1">les protéines membranaires</span>
            </h1>
            <p className="mt-4 max-w-[62ch] text-[16.5px] leading-7 text-indigo-100/90">
              De la séquence à la structure 3D, puis à l’évolution : MemProtScope réunit UniProtKB, DeepTMHMM, le PDB,
              AlphaFold et des outils d’analyse évolutive dans un seul espace, avec des résultats traçables.
            </p>

            <div className="glass-dark mt-6 rounded-2xl p-4 shadow-2xl shadow-indigo-950/40">
              <SearchForm />
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {HIGHLIGHTS.map((h) => (
                <div key={h.label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <dt className="sr-only">{h.label}</dt>
                  <dd className="text-[22px] font-extrabold tracking-tight text-white">{h.value}</dd>
                  <dd className="text-[12.5px] text-indigo-200">{h.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative flex animate-fade-up items-center [animation-delay:150ms]">
            <div aria-hidden className="absolute -inset-3 -z-10 rounded-[28px] bg-gradient-to-br from-cyan-400/40 via-violet-500/30 to-fuchsia-500/40 blur-2xl" />
            <div className="w-full overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl shadow-indigo-950/50">
              <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex gap-1.5" aria-hidden>
                    <span className="h-2.5 w-2.5 rounded-full bg-white/40" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/40" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/40" />
                  </span>
                  <p className="ml-2 text-[14px] font-bold text-white">Structure de référence</p>
                </div>
                <a
                  href="https://www.rcsb.org/structure/2RH1"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-white/20 px-2.5 py-0.5 font-mono text-[13px] font-semibold text-white transition hover:bg-white/30"
                >
                  PDB 2RH1
                </a>
              </div>
              <div className="h-[280px] w-full bg-[radial-gradient(circle_at_50%_40%,#eef2ff,#fff_70%)] lg:h-[340px]">
                <MiniProteinViewer pdbId="2RH1" speed={0.6} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
                <div>
                  <p className="text-[15px] font-bold text-slate-900">Récepteur β2-adrénergique humain</p>
                  <p className="text-[13px] text-slate-500">RCPG de classe A · 7 hélices TM · Diffraction X, 2,4 Å</p>
                </div>
                <span className="shrink-0 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 px-2.5 py-0.5 text-[12px] font-bold text-white">
                  7 TM
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="w-full space-y-14 px-4 py-12 lg:px-8">
        {/* Modules */}
        <section>
          <SectionHeader
            eyebrow="Modules"
            title="Tout pour étudier une protéine membranaire"
            text="Chaque module a sa couleur : on le retrouve dans les onglets et les résultats."
          />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {MODULES.map((m) => (
              <Link key={m.title} href={m.href} className="card card-hover group relative overflow-hidden p-5">
                <span aria-hidden className={`pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br ${m.glow} to-transparent blur-2xl transition group-hover:scale-125`} />
                <span className={`absolute inset-x-0 top-0 h-1 ${TONES[m.tone].bar}`} />
                <div className="relative flex items-start gap-4">
                  <span className={`rounded-2xl p-3 ${TONES[m.tone].badge}`}>{m.icon}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[18px] font-bold tracking-tight text-slate-900">{m.title}</h3>
                    <p className="mt-1 text-[14px] leading-5 text-slate-600">{m.text}</p>
                  </div>
                </div>
                <ul className="relative mt-4 flex flex-wrap gap-1.5">
                  {m.points.map((p) => (
                    <li key={p} className={`rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold ${TONES[m.tone].soft}`}>
                      {p}
                    </li>
                  ))}
                </ul>
                <span className={`relative mt-4 inline-flex items-center gap-1 text-[14px] font-bold ${TONES[m.tone].text}`}>
                  Ouvrir
                  <ArrowRight size={15} className="transition group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <SequencePaste id="sequence" />

        {/* Pipeline */}
        <section id="pipeline" className="scroll-mt-28">
          <SectionHeader
            eyebrow="Méthodologie"
            title="Pipeline d’analyse"
            text="Chaque requête suit le même enchaînement. L’analyse structurale n’est menée que si la protéine est identifiée comme membranaire."
          />
          <ol className="relative mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <span aria-hidden className="absolute left-[10%] right-[10%] top-[34px] hidden h-0.5 bg-gradient-to-r from-blue-400 via-violet-400 to-rose-400 lg:block" />
            {PIPELINE.map((step, i) => (
              <li key={step.title} className="card card-hover relative p-5">
                <div className="flex items-center gap-3">
                  <span className={`relative flex h-9 w-9 items-center justify-center rounded-xl ${TONES[step.tone].badge}`}>
                    {step.icon}
                  </span>
                  <span className="text-[13px] font-extrabold text-slate-300">0{i + 1}</span>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11.5px] font-bold ${TONES[step.tone].soft}`}>
                    {step.source}
                  </span>
                </div>
                <h3 className="mt-3 text-[16px] font-bold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-[14px] leading-5 text-slate-600">{step.text}</p>
              </li>
            ))}
          </ol>
          <Link
            href="/analyses"
            className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 px-5 py-3 text-[14px] text-slate-700 transition hover:border-indigo-300"
          >
            <FileText size={18} className="text-indigo-600" />
            Chaque calcul garde ses étapes, ses paramètres, les versions des bases consultées et ses erreurs.
            <span className="ml-auto inline-flex items-center gap-1 font-bold text-indigo-700">
              Suivre mes analyses <ArrowRight size={15} />
            </span>
          </Link>
        </section>

        {/* Analyses */}
        <section id="analyses" className="scroll-mt-28">
          <SectionHeader
            eyebrow="Fonctionnalités"
            title="Analyses disponibles"
            text="Des résultats interprétables, avec leurs limites clairement signalées."
          />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ANALYSES.map((a) => (
              <div key={a.title} className="card card-hover flex gap-4 p-5">
                <div className={`h-fit rounded-xl p-2.5 ${TONES[a.tone].badge}`}>{a.icon}</div>
                <div>
                  <h3 className="text-[16px] font-bold text-slate-900">{a.title}</h3>
                  <p className="mt-1 text-[14px] leading-5 text-slate-600">{a.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Structures de référence */}
        <section id="structures" className="scroll-mt-28">
          <SectionHeader
            eyebrow="Exemples"
            title="Structures membranaires de référence"
            text="Trois familles classiques de protéines membranaires, chargées depuis le RCSB PDB."
          />
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {FEATURED.map((s) => (
              <a
                key={s.pdbId}
                href={`https://www.rcsb.org/structure/${s.pdbId}`}
                target="_blank"
                rel="noreferrer"
                className="card card-hover group relative overflow-hidden"
              >
                <span className={`absolute inset-x-0 top-0 z-10 h-1 ${TONES[s.tone].bar}`} />
                <div className="h-[220px] w-full bg-[radial-gradient(circle_at_50%_45%,#f5f3ff,#fff_70%)]">
                  <MiniProteinViewer pdbId={s.pdbId} speed={0.6} />
                </div>
                <div className="flex items-start justify-between gap-2 border-t border-slate-100 px-5 py-3">
                  <div>
                    <p className="text-[16px] font-bold text-slate-900 transition group-hover:text-indigo-700">{s.name}</p>
                    <p className="text-[13px] italic text-slate-500">{s.organism}</p>
                    <p className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[12px] font-semibold ${TONES[s.tone].soft}`}>
                      {s.family}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-lg px-2 py-0.5 font-mono text-[13px] font-semibold ${TONES[s.tone].badge}`}>
                    {s.pdbId}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Appel à l'action */}
        <section className={`${HERO_BG} overflow-hidden rounded-3xl px-6 py-10 text-center shadow-2xl shadow-indigo-900/20 sm:px-10`}>
          <div aria-hidden className={HERO_GLOW} />
          <h2 className="text-[28px] font-extrabold tracking-tight text-white sm:text-[34px]">
            Une famille de protéines à étudier ?
          </h2>
          <p className="mx-auto mt-2 max-w-[60ch] text-[16px] leading-7 text-indigo-100">
            Importez vos homologues au format FASTA : conservation, topologie, phylogénie et coévolution en une seule analyse.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/explorateur"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[15px] font-bold text-indigo-700 shadow-lg shadow-indigo-950/30 transition hover:-translate-y-0.5"
            >
              <Sparkles size={17} />
              Ouvrir l’explorateur
            </Link>
            <Link
              href="/comparaison"
              className="glass-dark inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[15px] font-bold text-white transition hover:bg-white/20"
            >
              <GitCompare size={17} />
              Comparer des protéines
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function SectionHeader({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="max-w-3xl">
      <p className="inline-flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.18em] text-indigo-600">
        <span className="h-0.5 w-6 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" />
        {eyebrow}
      </p>
      <h2 className="mt-2 text-[28px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[32px]">{title}</h2>
      <p className="mt-2 text-[15.5px] leading-6 text-slate-500">{text}</p>
    </div>
  );
}
