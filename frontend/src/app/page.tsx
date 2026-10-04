"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MiniProteinViewer from "../components/MiniProteinViewer";
import {
  Search,
  Database,
  Boxes,
  Layers3,
  ShieldCheck,
  Dna,
  Activity,
  ArrowRight,
  Microscope,
  FileSearch,
} from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const examples = useMemo(
    () => ["P69905", "P04406", "Q8N158", "P01308"],
    []
  );

  const handleSearch = () => {
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="min-h-screen bg-[#eef3f8] text-slate-900">
      <div className="mx-auto max-w-[1280px] px-5 py-6">
        <header className="mx-auto mb-6 flex max-w-5xl items-center justify-between rounded-2xl border border-blue-900 bg-gradient-to-r from-[#0b3c7a] to-[#0e4ea8] px-6 py-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/10 p-2 text-white shadow">
              <Layers3 size={20} />
            </div>

            <div>
              <p className="text-sm font-semibold text-white">MemProtScope</p>
              <p className="text-xs text-blue-200">
                Plateforme d’analyse des protéines membranaires
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-3 md:flex">
            <button className="rounded-full bg-white/10 px-3 py-1 text-sm text-white shadow">
              Accueil
            </button>
            <button className="text-sm text-blue-200 transition hover:text-white">
              Recherche
            </button>
            <button className="text-sm text-blue-200 transition hover:text-white">
              Structures
            </button>
            <button className="text-sm text-blue-200 transition hover:text-white">
              Rapports
            </button>
          </nav>
        </header>

        <main className="mx-auto max-w-[1120px] space-y-6">
          <section className="grid gap-5 rounded-[26px] border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-100">
                <Microscope size={14} />
                Plateformes de Prediction de structure 3D de Proteine Membranaire 
              </div>

              <div className="space-y-3">
                <h2 className="max-w-[620px] text-[34px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[40px]">
                   Détecter, Predire
                  <span className="block text-[#0b5cab]">
                    et interpréter les protéines membranaires
                  </span>
                </h2>

                <p className="max-w-[640px] text-[13px] leading-6 text-slate-600">
                  MemProtScope centralise l’annotation UniProt, la détection
                  membranaire, l’analyse structurale expérimentale et la
                  prédiction lorsque les structures n’existent pas.
                </p>
              </div>

              <div className="max-w-[700px] rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Recherche principale
                </p>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearch();
                      }}
                      placeholder="ID UniProt, ID PDB ou séquence FASTA..."
                      className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
                    />
                  </div>

                  <button
                    onClick={handleSearch}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0b5cab] px-5 py-3 text-[13px] font-semibold text-white transition hover:bg-[#094b8a]"
                  >
                    Analyser
                    <ArrowRight size={16} />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {examples.map((example) => (
                    <button
                      key={example}
                      onClick={() => router.push(`/search?q=${example}`)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    >
                      {example}
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniPill icon={<Database size={15} />} label="UniProt" tone="blue" />
                  <MiniPill icon={<Activity size={15} />} label="DeepTMHMM" tone="green" />
                  <MiniPill icon={<Boxes size={15} />} label="PDB" tone="violet" />
                  <MiniPill icon={<ShieldCheck size={15} />} label="Prédiction" tone="amber" />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Vue d’ensemble
                    </p>
                    <h3 className="mt-1 text-[22px] font-bold text-slate-900">
                      Structures 3D des Proteines
                    </h3>
                  </div>

                  <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-medium text-blue-700 ring-1 ring-blue-100">
                    Aperçu vivant
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <ViewerCard pdbId="1HBB" />
                  <ViewerCard pdbId="1UBQ" />
                  <ViewerCard pdbId="4HHB" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-green-100 p-4">
                  <h4 className="text-sm font-semibold text-green-900">
                    Détection membranaire
                  </h4>
                  <p className="mt-1 text-xs text-green-700">
                    Segments TM, statut, topologie
                  </p>
                </div>

                <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4">
                  <h4 className="text-sm font-semibold text-blue-900">
                    Structures expérimentales
                  </h4>
                  <p className="mt-1 text-xs text-blue-700">
                    Sélection, résolution, détails
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-3">
            <FeatureCard
              icon={<Database size={18} />}
              title="Annotations biologiques"
              description="Récupération structurée des informations principales : accession, organisme, gènes, fonction et séquence."
              tone="blue"
            />
            <FeatureCard
              icon={<Activity size={18} />}
              title="Filtrage membranaire"
              description="Le pipeline vérifie d’abord le caractère membranaire avant de poursuivre l’exploration structurale."
              tone="green"
            />
            <FeatureCard
              icon={<Boxes size={18} />}
              title="Évidence structurale"
              description="Les structures expérimentales sont priorisées. La prédiction n’intervient qu’en absence de structure fiable."
              tone="yellow"
            />
          </section>

          <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Organisation de la plateforme
                </p>
                <h3 className="mt-2 text-[22px] font-bold text-slate-900">
                  Modules principaux
                </h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <ModuleCard
                  icon={<Database size={16} />}
                  title="UniProt"
                  text="Source principale pour l’annotation et la séquence."
                  tone="blue"
                />
                <ModuleCard
                  icon={<Activity size={16} />}
                  title="DeepTMHMM"
                  text="Détection membranaire et topologie."
                  tone="green"
                />
                <ModuleCard
                  icon={<Boxes size={16} />}
                  title="PDB"
                  text="Exploration des structures expérimentales."
                  tone="violet"
                />
                <ModuleCard
                  icon={<ShieldCheck size={16} />}
                  title="Fallback prédictif"
                  text="AlphaFold si aucune structure n’est disponible."
                  tone="amber"
                />
                <ModuleCard
                  icon={<FileSearch size={16} />}
                  title="Validation"
                  text="Évaluation de la qualité, cohérence et confiance des résultats."
                  tone="rose"
                  fullWidth
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f7fafe)] p-5 shadow-sm">
              <div className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Galerie scientifique
                </p>
                <h3 className="mt-2 text-[22px] font-bold text-slate-900">
                  Motifs structuraux
                </h3>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <MiniStructureCard tone="blue" variant="helix" />
                <MiniStructureCard tone="violet" variant="loop" />
                <MiniStructureCard tone="green" variant="sheet" />
              </div>

              <div className="mt-5 rounded-[20px] border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Structure 3D
                    </p>
                    <h4 className="mt-1 text-[15px] font-semibold text-slate-900">
                      Aperçu protéique 
                    </h4>
                  </div>

                  <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-medium text-blue-700 ring-1 ring-blue-100">
                    Vue dynamique
                  </span>
                </div>

                <div className="flex justify-center items-center">
                  <div className="h-[160px] w-[160px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md">
                    <MiniProteinViewer pdbId="1HBB" speed={1.2} />
                  </div>
                </div>
              </div>

              <p className="mt-4 text-[12px] leading-6 text-slate-500">
                Une identité visuelle compacte 
                structurales réelles, avec des éléments 3D dynamiques et
                des motifs scientifiques statiques.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function ViewerCard({ pdbId }: { pdbId: string }) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="h-[120px] w-[120px] overflow-hidden rounded-2xl">
        <MiniProteinViewer pdbId={pdbId} speed={1.2} />
      </div>
    </div>
  );
}

function MiniPill({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "blue" | "green" | "violet" | "amber";
}) {
  const tones = {
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    green: "border-emerald-100 bg-emerald-50 text-emerald-700",
    violet: "border-violet-100 bg-violet-50 text-violet-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-[12px] ${tones[tone]}`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "blue" | "green" | "yellow";
}) {
  const styles = {
    blue: "border-blue-100 bg-[linear-gradient(180deg,#eff6ff,#dbeafe)]",
    green: "border-emerald-100 bg-[linear-gradient(180deg,#ecfdf5,#d1fae5)]",
    yellow: "border-amber-100 bg-[linear-gradient(180deg,#fffbeb,#fef3c7)]",
  };

  const iconStyles = {
    blue: "bg-white/70 text-blue-700",
    green: "bg-white/70 text-emerald-700",
    yellow: "bg-white/70 text-amber-700",
  };

  return (
    <div className={`rounded-[20px] border p-2 shadow-sm ${styles[tone]}`}>
      <div className={`mb-2 inline-flex rounded-2xl p-3 ${iconStyles[tone]}`}>
        {icon}
      </div>
      <h3 className="text-[14px] font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-[11px] leading-6 text-slate-700">{description}</p>
    </div>
  );
}

function ModuleCard({
  icon,
  title,
  text,
  tone,
  fullWidth = false,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  tone: "blue" | "green" | "violet" | "amber" | "rose";
  fullWidth?: boolean;
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    green: "bg-emerald-50 text-emerald-700 border-emerald-100",
    violet: "bg-violet-50 text-violet-700 border-violet-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
  };

  return (
    <div
      className={`rounded-[18px] border p-3 ${tones[tone]} ${
        fullWidth ? "sm:col-span-2" : ""
      }`}
    >
      <div className="mb-3 inline-flex rounded-xl bg-white/70 p-2">{icon}</div>
      <h4 className="text-[13px] font-semibold text-slate-900">{title}</h4>
      <p className="mt-1 text-[10px] leading-4 text-slate-600">{text}</p>
    </div>
  );
}

function MiniStructureCard({
  tone,
  variant,
}: {
  tone: "blue" | "violet" | "green";
  variant: "helix" | "loop" | "sheet";
}) {
  const tones = {
    blue: "from-cyan-400 to-blue-600",
    violet: "from-violet-400 to-fuchsia-600",
    green: "from-emerald-400 to-teal-600",
  };

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-3">
      <div
        className={`flex h-[86px] w-[86px] items-center justify-center rounded-[26px] bg-gradient-to-br ${tones[tone]} shadow-md`}
      >
        <StructureGlyph variant={variant} />
      </div>
    </div>
  );
}

function StructureGlyph({
  variant,
}: {
  variant: "helix" | "loop" | "sheet";
}) {
  if (variant === "helix") {
    return (
      <svg
        width="54"
        height="54"
        viewBox="0 0 54 54"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="opacity-95"
      >
        <path
          d="M15 40C20 34 20 20 27 15C32 12 36 14 39 18"
          stroke="white"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M14 31C18 27 21 25 25 25C29 25 32 27 36 31"
          stroke="white"
          strokeWidth="3.2"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M16 22C20 19 23 18 27 18C31 18 34 20 38 24"
          stroke="white"
          strokeWidth="3.2"
          strokeLinecap="round"
          opacity="0.8"
        />
      </svg>
    );
  }

  if (variant === "loop") {
    return (
      <svg
        width="54"
        height="54"
        viewBox="0 0 54 54"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="opacity-95"
      >
        <path
          d="M14 30C14 20 22 14 30 14C37 14 41 19 41 25C41 31 37 35 31 35C25 35 21 31 21 26C21 22 24 19 28 19"
          stroke="white"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="30" cy="26" r="3.5" fill="white" opacity="0.9" />
      </svg>
    );
  }

  return (
    <svg
      width="54"
      height="54"
      viewBox="0 0 54 54"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="opacity-95"
    >
      <path
        d="M14 34L23 18L31 26L40 14"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 39H38"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M22 43H34"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}