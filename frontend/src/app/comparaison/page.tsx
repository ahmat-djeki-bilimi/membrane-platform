"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, GitCompare, Loader2, Plus, Star, X } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { MAX_PROTEINS, MIN_PROTEINS, proteinColor, submitComparison } from "@/lib/comparison";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

const ACCESSION = /^[A-Z0-9]{6,10}$/;

const EXAMPLES = [
  { label: "Rhodopsines microbiennes", ids: ["P02945", "P15647", "P42196"], text: "bactériorhodopsine, halorhodopsine, rhodopsine sensorielle II" },
  { label: "Aquaporines humaines", ids: ["P29972", "P41181", "Q13520"], text: "AQP1, AQP2, AQP6" },
  { label: "Récepteurs β-adrénergiques", ids: ["P07550", "P08588"], text: "β2 et β1 humains (RCPG)" },
];

const FEATURES = [
  ["Séquences", "identité, similarité, alignement et correspondance des résidus, même pour des longueurs différentes"],
  ["Structures 3D", "modèles AlphaFold superposés, RMSD, TM-score, écart résidu par résidu"],
  ["Domaines et topologie", "domaines UniProt et segments transmembranaires placés dans un repère commun"],
  ["Conservation et propriétés", "positions conservées comparées, masse, pI, charge, hydropathie, composition"],
];

/** Choix des protéines à comparer (les résultats ont leur propre page). */
export default function ComparisonStartPage() {
  return (
    <Suspense fallback={null}>
      <ComparisonStart />
    </Suspense>
  );
}

function ComparisonStart() {
  const router = useRouter();
  const params = useSearchParams();
  // Lien direct : /comparaison?ids=P02945,P15647
  const [ids, setIds] = useState<string[]>(() =>
    (params.get("ids") ?? "")
      .split(/[\s,;]+/)
      .map((v) => v.toUpperCase())
      .filter((v) => ACCESSION.test(v))
      .slice(0, MAX_PROTEINS)
  );
  const [reference, setReference] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const add = (text: string) => {
    const values = text
      .split(/[\s,;]+/)
      .map((v) => v.toUpperCase().trim())
      .filter(Boolean);
    const invalid = values.filter((v) => !ACCESSION.test(v));
    const next = [...ids];
    for (const v of values) if (ACCESSION.test(v) && !next.includes(v) && next.length < MAX_PROTEINS) next.push(v);
    setIds(next);
    setDraft("");
    setError(invalid.length ? `Accession(s) UniProt invalide(s) : ${invalid.join(", ")}` : next.length >= MAX_PROTEINS && values.length > 0 ? `${MAX_PROTEINS} protéines au maximum.` : null);
  };
  const remove = (k: number) => {
    setIds(ids.filter((_, i) => i !== k));
    setReference((r) => (k === r ? 0 : k < r ? r - 1 : r));
  };

  const submit = async (list = ids, ref = reference) => {
    setSubmitting(true);
    setError(null);
    try {
      const job = await submitComparison(list, ref);
      router.push(`/comparaison/${job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de joindre le serveur.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="comparison" />
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-6 lg:px-6">
          <nav className="flex items-center gap-1 text-[13px] text-blue-200">
            <Link href="/" className="hover:text-white">
              Accueil
            </Link>
            <ChevronRight size={12} />
            <span className="text-white">Comparaison</span>
          </nav>
          <h1 className="mt-2 flex items-center gap-2 text-[28px] font-bold text-white">
            <GitCompare size={26} />
            Comparer des protéines
          </h1>
          <p className="mt-1 max-w-3xl text-[15px] text-blue-100">
            De {MIN_PROTEINS} à {MAX_PROTEINS} entrées UniProt : séquences, structures 3D, domaines, topologies, positions conservées et
            propriétés physico-chimiques, dans un même repère de résidus.
          </p>
        </div>
      </section>

      <main className="w-full flex-1 space-y-4 px-4 py-5 lg:px-6">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-[16px] font-semibold text-slate-900">Protéines à comparer</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add(draft);
            }}
            className="mt-2 flex flex-wrap gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Accession UniProt (ex. P02945), une ou plusieurs séparées par des virgules"
              className="min-w-[280px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-blue-500"
            />
            <button type="submit" disabled={!draft.trim() || ids.length >= MAX_PROTEINS} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <Plus size={14} />
              Ajouter
            </button>
          </form>

          {ids.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {ids.map((id, k) => (
                <li key={id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 py-1 pl-2 pr-1 text-[14px]">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: proteinColor(k) }} />
                  <span className="font-mono font-semibold">{id}</span>
                  <button
                    onClick={() => setReference(k)}
                    title="Protéine de référence : repère de l’alignement et de la superposition"
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ${reference === k ? "bg-amber-100 text-amber-800" : "text-slate-500 hover:bg-slate-200"}`}
                  >
                    <Star size={11} />
                    {reference === k ? "référence" : "choisir comme référence"}
                  </button>
                  <button onClick={() => remove(k)} aria-label={`Retirer ${id}`} className="rounded p-1 text-slate-500 hover:bg-slate-200">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mt-2 text-[13px] text-rose-700">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => submit()}
              disabled={ids.length < MIN_PROTEINS || submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0f4c81] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#0c3d68] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <GitCompare size={14} />}
              Comparer {ids.length >= MIN_PROTEINS ? `${ids.length} protéines` : ""}
            </button>
            <span className="text-[13px] text-slate-500">
              {ids.length < MIN_PROTEINS ? `Ajoutez au moins ${MIN_PROTEINS} protéines.` : "Quelques secondes : alignements, modèles AlphaFold, superpositions."}
            </span>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-[16px] font-semibold text-slate-900">Exemples</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {EXAMPLES.map((e) => (
              <button
                key={e.label}
                onClick={() => {
                  setIds(e.ids);
                  setReference(0);
                  submit(e.ids, 0);
                }}
                disabled={submitting}
                className="rounded-md border border-slate-200 p-3 text-left hover:border-[#0f4c81] disabled:opacity-50"
              >
                <p className="text-[14px] font-semibold text-slate-900">{e.label}</p>
                <p className="text-[13px] text-slate-500">{e.text}</p>
                <p className="mt-1 font-mono text-[12px] text-slate-600">{e.ids.join(" · ")}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {FEATURES.map(([title, text]) => (
            <div key={title} className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[14px] font-semibold text-slate-900">{title}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-slate-500">{text}</p>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
