"use client";

import MiniProteinViewer from "../components/MiniProteinViewer";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import SearchForm from "../components/SearchForm";
import SequencePaste from "../components/SequencePaste";
import { HERO_BG, HERO_GLOW, TONES, type Tone } from "../lib/theme";
import {
  Database,
  Boxes,
  Layers3,
  ShieldCheck,
  Activity,
  Compass,
  Puzzle,
  Crosshair,
  GitCompare,
  BarChart3,
  ChevronRight,
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

const PIPELINE = [
  {
    icon: <Database size={16} />,
    source: "UniProtKB",
    tone: "blue" as Tone,
    title: "Annotation",
    text: "Séquence, organisme, gènes et fonction de la protéine.",
  },
  {
    icon: <Activity size={16} />,
    source: "DeepTMHMM",
    tone: "emerald" as Tone,
    title: "Détection membranaire",
    text: "Segments transmembranaires, topologie et type de protéine.",
  },
  {
    icon: <Boxes size={16} />,
    source: "RCSB PDB",
    tone: "violet" as Tone,
    title: "Structures expérimentales",
    text: "Sélection des entrées par méthode et résolution.",
  },
  {
    icon: <Layers3 size={16} />,
    source: "AlphaFold DB",
    tone: "amber" as Tone,
    title: "Prédiction",
    text: "Modèle prédit utilisé uniquement en l’absence de structure expérimentale.",
  },
  {
    icon: <ShieldCheck size={16} />,
    source: "ERRAT · OPM",
    tone: "rose" as Tone,
    title: "Validation",
    text: "Qualité du modèle et orientation dans la bicouche lipidique.",
  },
];

const ANALYSES = [
  {
    icon: <Activity size={16} />,
    title: "Topologie transmembranaire",
    tone: "emerald" as Tone,
    text: "Cartographie des segments TM sur la séquence et la structure 3D.",
  },
  {
    icon: <Compass size={16} />,
    title: "Orientation membranaire",
    tone: "cyan" as Tone,
    text: "Position et inclinaison de la protéine dans la membrane (OPM).",
  },
  {
    icon: <Puzzle size={16} />,
    title: "Domaines structuraux",
    tone: "violet" as Tone,
    text: "Identification et délimitation des domaines fonctionnels.",
  },
  {
    icon: <BarChart3 size={16} />,
    title: "Qualité structurale",
    tone: "amber" as Tone,
    text: "Score ERRAT et indicateurs de fiabilité par résidu.",
  },
  {
    icon: <Crosshair size={16} />,
    title: "Site actif",
    tone: "rose" as Tone,
    text: "Localisation des résidus catalytiques et sites de liaison.",
  },
  {
    icon: <GitCompare size={16} />,
    title: "Comparaison multi-structures",
    tone: "blue" as Tone,
    text: "Superposition et comparaison des entrées PDB disponibles.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="home" />

      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative grid w-full gap-6 px-4 py-6 lg:grid-cols-[1.25fr_1fr] lg:px-6 lg:py-8">
          <div className="flex flex-col justify-center">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300/30 bg-white/10 px-3 py-1 text-[13px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Plateforme bioinformatique
            </p>
            <h1 className="mt-2 text-[32px] font-bold leading-tight tracking-tight text-white sm:text-[40px]">
              Détecter, prédire et interpréter
              <span className="block bg-gradient-to-r from-cyan-300 to-emerald-300 bg-clip-text text-transparent">
                les protéines membranaires
              </span>
            </h1>
            <p className="mt-3 max-w-[70ch] text-[16px] leading-6 text-blue-100">
              MemProtScope relie l’annotation UniProtKB, la détection des segments
              transmembranaires, les structures expérimentales du PDB et les modèles
              AlphaFold dans un pipeline unique, avec validation de la qualité et de
              l’orientation membranaire.
            </p>

            <div className="mt-5">
              <SearchForm />
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/20 bg-white shadow-2xl shadow-black/30">
            <div className="flex items-center justify-between bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2">
              <p className="text-[14px] font-semibold text-white">
                Structure de référence
              </p>
              <a
                href="https://www.rcsb.org/structure/2RH1"
                target="_blank"
                rel="noreferrer"
                className="rounded bg-white/20 px-2 py-0.5 font-mono text-[13px] font-semibold text-white hover:bg-white/30"
              >
                PDB 2RH1
              </a>
            </div>
            <div className="h-[260px] w-full lg:h-[300px]">
              <MiniProteinViewer pdbId="2RH1" speed={0.6} />
            </div>
            <div className="border-t border-slate-100 px-4 py-2">
              <p className="text-[15px] font-semibold text-slate-900">
                Récepteur β2-adrénergique humain
              </p>
              <p className="text-[13px] text-slate-500">
                RCPG de classe A · 7 hélices transmembranaires · Diffraction X, 2,4 Å
              </p>
            </div>
          </div>
        </div>
      </section>

      <main className="w-full space-y-4 px-4 py-4 lg:px-6">
        <SequencePaste id="sequence" />

        <section id="pipeline" className="scroll-mt-16 rounded-lg border border-slate-200 bg-white">
          <SectionHeader
            eyebrow="Méthodologie"
            title="Pipeline d’analyse"
            text="Chaque requête suit le même enchaînement. L’analyse structurale n’est menée que si la protéine est identifiée comme membranaire."
          />
          <ol className="grid border-t border-slate-100 sm:grid-cols-2 lg:grid-cols-5">
            {PIPELINE.map((step, i) => (
              <li
                key={step.title}
                className="relative border-slate-100 p-4 max-lg:border-b sm:max-lg:odd:border-r lg:border-r lg:last:border-r-0"
              >
                <span className={`absolute inset-x-0 top-0 h-1 ${TONES[step.tone].bar}`} />
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-bold ${TONES[step.tone].badge}`}
                  >
                    {i + 1}
                  </span>
                  <span className={TONES[step.tone].text}>{step.icon}</span>
                  <span
                    className={`ml-auto rounded px-1.5 py-0.5 text-[12px] font-semibold ${TONES[step.tone].soft}`}
                  >
                    {step.source}
                  </span>
                </div>
                <h3 className="text-[16px] font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-[14px] leading-5 text-slate-600">{step.text}</p>
                {i < PIPELINE.length - 1 && (
                  <ChevronRight
                    size={16}
                    className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white text-slate-300 lg:block"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>

        <section id="analyses" className="scroll-mt-16 rounded-lg border border-slate-200 bg-white">
          <SectionHeader
            eyebrow="Fonctionnalités"
            title="Analyses disponibles"
            text="Résultats consultables pour chaque structure retenue."
          />
          <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
            {ANALYSES.map((a) => (
              <div key={a.title} className="flex gap-3 bg-white p-4">
                <div className={`h-fit rounded-md p-2.5 shadow-sm ${TONES[a.tone].badge}`}>
                  {a.icon}
                </div>
                <div>
                  <h3 className="text-[16px] font-semibold text-slate-900">{a.title}</h3>
                  <p className="mt-0.5 text-[14px] leading-5 text-slate-600">{a.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="structures" className="scroll-mt-16 rounded-lg border border-slate-200 bg-white">
          <SectionHeader
            eyebrow="Exemples"
            title="Structures membranaires de référence"
            text="Trois familles classiques de protéines membranaires, chargées depuis le RCSB PDB."
          />
          <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-3">
            {FEATURED.map((s) => (
              <a
                key={s.pdbId}
                href={`https://www.rcsb.org/structure/${s.pdbId}`}
                target="_blank"
                rel="noreferrer"
                className="group relative bg-white"
              >
                <span className={`absolute inset-x-0 top-0 z-10 h-1 ${TONES[s.tone].bar}`} />
                <div className="h-[200px] w-full">
                  <MiniProteinViewer pdbId={s.pdbId} speed={0.6} />
                </div>
                <div className="flex items-start justify-between gap-2 border-t border-slate-100 px-4 py-2">
                  <div>
                    <p className="text-[15px] font-semibold text-slate-900 group-hover:text-[#0f4c81]">
                      {s.name}
                    </p>
                    <p className="text-[13px] italic text-slate-500">{s.organism}</p>
                    <p className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[12px] font-semibold ${TONES[s.tone].soft}`}>
                      {s.family}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 font-mono text-[13px] font-semibold ${TONES[s.tone].badge}`}
                  >
                    {s.pdbId}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="border-l-4 border-cyan-500 px-4 py-3">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
        {eyebrow}
      </p>
      <h2 className="mt-0.5 text-[20px] font-bold text-slate-900">{title}</h2>
      <p className="mt-0.5 text-[14px] text-slate-500">{text}</p>
    </div>
  );
}
