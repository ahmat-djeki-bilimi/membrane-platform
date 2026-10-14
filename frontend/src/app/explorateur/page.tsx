"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Dna, GitCompareArrows, Layers, Loader2, Sparkles } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ImportPanel from "@/components/explorer/ImportPanel";
import { SEQUENCE_STORAGE_PREFIX } from "@/components/SearchForm";
import { fetchHomologFasta, submitExplorer, type ExplorerRequest } from "@/lib/explorer";
import { HERO_BG, HERO_GLOW, TONES, type Tone } from "@/lib/theme";

const FEATURES = [
  {
    title: "Conservation des résidus des protéines membranaires",
    text: "Comparer les séquences homologues et déterminer quels acides aminés sont conservés dans les hélices transmembranaires, les boucles et les régions exposées.",
    interest: "identifier des résidus candidats importants pour la structure et la fonction.",
    tone: "violet" as Tone,
    icon: <Dna size={18} />,
  },
  {
    title: "Visualisation des résidus fonctionnels dans la membrane",
    text: "Associer l’alignement aux prédictions DeepTMHMM, aux structures AlphaFold et à l’orientation membranaire issue d’OPM.",
    interest: "déterminer où se trouvent les résidus d’intérêt par rapport à la membrane et aux éventuelles poches fonctionnelles.",
    tone: "amber" as Tone,
    icon: <Layers size={18} />,
  },
  {
    title: "Coévolution des résidus transmembranaires",
    text: "Étudier les positions qui évoluent de manière corrélée dans une famille de protéines membranaires.",
    interest: "rechercher des réseaux de résidus participant aux interactions entre hélices, à la stabilité ou aux changements fonctionnels.",
    tone: "emerald" as Tone,
    icon: <GitCompareArrows size={18} />,
  },
];

/** Membrane Evolution & Function Explorer : importation de la famille (les résultats ont leur propre page). */
export default function ExplorerImportPage() {
  // useSearchParams exige une frontière Suspense pour le rendu statique (next build)
  return (
    <Suspense fallback={null}>
      <ExplorerImport />
    </Suspense>
  );
}

function ExplorerImport() {
  const router = useRouter();
  const params = useSearchParams();
  // Lien depuis la page d'une protéine (/explorateur?accession=P07550) ou
  // depuis une séquence collée (/explorateur?seq=…, relue dans la session)
  const accession = params.get("accession")?.toUpperCase().trim() || null;
  const [initialFasta] = useState<string | null>(() => {
    const seqId = params.get("seq");
    if (!seqId || typeof window === "undefined") return null;
    try {
      const stored = JSON.parse(sessionStorage.getItem(SEQUENCE_STORAGE_PREFIX + seqId) ?? "null");
      return stored?.sequence ? `>${stored.header || "sequence"}
${stored.sequence}
` : null;
    } catch {
      return null;
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoLaunch = !!(accession || initialFasta);

  const submit = async (request: ExplorerRequest, tab?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const job = await submitExplorer(request);
      router.replace(`/explorateur/${job.id}${tab ? `?tab=${tab}` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de joindre le serveur.");
      setSubmitting(false);
    }
  };

  // Venant d'une protéine ou d'une séquence : pas d'étape d'import, l'analyse
  // part aussitôt (homologues UniRef50 + recherche étendue) et s'ouvre sur l'alignement
  const launched = useRef(false);
  useEffect(() => {
    if (!autoLaunch || launched.current) return;
    launched.current = true;
    const start = async () => {
      const fasta = accession ? (await fetchHomologFasta(accession)).fasta : initialFasta!;
      await submit({ fasta, reference: 0, accession, expand: true }, "homologues");
    };
    start().catch((e) => setError(e instanceof Error ? e.message : "Impossible de joindre le serveur."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLaunch]);

  if (autoLaunch) {
    return (
      <div className="flex min-h-screen flex-col app-bg text-slate-900">
        <SiteHeader active="explorer" />
        <main className="flex w-full flex-1 flex-col gap-4 px-4 py-6 lg:px-6">
          <section className="card p-5">
            {error ? (
              <>
                <p className="text-[15px] text-rose-700">Analyse impossible : {error}</p>
                <Link href="/explorateur" className="mt-3 inline-block text-[14px] font-semibold text-blue-700 hover:underline">
                  Importer des séquences à la main
                </Link>
              </>
            ) : (
              <div className="flex items-start gap-3 text-slate-600">
                <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-cyan-600" />
                <div>
                  <p className="font-semibold text-slate-900">
                    {accession ? `Recherche des homologues de ${accession}…` : "Lancement de l’analyse de la séquence…"}
                  </p>
                  <p className="text-[14px]">Orthologues UniProt (UniRef50), puis recherche étendue MMseqs2 et alignement.</p>
                </div>
              </div>
            )}
          </section>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col app-bg text-slate-900">
      <SiteHeader active="explorer" />

      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-5 lg:px-6">
          <nav className="flex flex-wrap items-center gap-1 text-[13px] text-indigo-200">
            <Link href="/" className="hover:text-white">
              Accueil
            </Link>
            <ChevronRight size={12} />
            <span className="text-white">Explorateur</span>
          </nav>
          <span className="mt-2 inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-[13px] font-semibold text-white">
            <Sparkles size={13} />
            Membrane Evolution &amp; Function Explorer
          </span>
          <h1 className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">
            Évolution et fonction des protéines membranaires
          </h1>
          <p className="text-[15px] text-indigo-100">
            De la famille de séquences homologues à la carte des résidus importants dans la membrane
          </p>
        </div>
      </section>

      <main className="flex w-full flex-1 flex-col gap-4 px-4 py-4 lg:px-6">
        <ImportPanel onSubmit={(request) => submit(request)} submitting={submitting} error={error} />

        <section className="card">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Ce que fait le module</p>
            <h2 className="text-[17px] font-semibold text-slate-900">Trois questions sur une famille de protéines membranaires</h2>
          </div>
          <div className="grid gap-px bg-slate-100 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className={`rounded-lg p-2 shadow-sm ${TONES[f.tone].badge}`}>{f.icon}</span>
                  <h3 className="text-[15px] font-semibold leading-5 text-slate-900">
                    {i + 1}. {f.title}
                  </h3>
                </div>
                <p className="mt-2 text-[14px] leading-5 text-slate-600">{f.text}</p>
                <p className="mt-1.5 text-[14px] leading-5 text-slate-600">
                  <b className="text-slate-800">Intérêt :</b> {f.interest}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
