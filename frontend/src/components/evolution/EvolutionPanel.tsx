"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Download, GitBranch, Loader2, Sparkles } from "lucide-react";
import ConservationProfile from "./ConservationProfile";
import { SEQUENCE_STORAGE_PREFIX } from "@/components/SearchForm";
import {
  CONSURF_COLORS,
  useConservation,
  useSequenceConservation,
  type ConservationResult,
  type ConservationSource,
} from "@/lib/conservation";
import { downloadText, hashSequence } from "@/lib/sequence";

const fmt = (v?: number | null, d = 2) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Aperçu évolutif d'une protéine : conservation de chaque résidu calculée sur
 * des homologues trouvés automatiquement. L'analyse complète (alignement,
 * arbre phylogénétique, membrane, candidats, coévolution) est dans l'Explorateur.
 */
export default function EvolutionPanel({
  accession,
  sequence,
  name = "sequence",
}: {
  accession?: string | null;
  sequence?: string | null;
  name?: string;
}) {
  const [source, setSource] = useState<ConservationSource>("uniref50");
  const byAccession = useConservation(accession, source);
  const bySequence = useSequenceConservation(accession ? null : sequence, name);
  const { status, result, error, matched } = accession ? byAccession : bySequence;
  const fileBase = accession ?? (name.replace(/[^\w.-]+/g, "_") || "sequence");
  const explorerAccession = accession ?? matched?.accession ?? null;

  // Séquence sans entrée UniProt : transmise à l'Explorateur par la session du navigateur
  const explorerHref = explorerAccession
    ? `/explorateur?accession=${explorerAccession}`
    : sequence
      ? `/explorateur?seq=${hashSequence(sequence)}`
      : "/explorateur";
  const rememberSequence = () => {
    if (explorerAccession || !sequence) return;
    try {
      sessionStorage.setItem(SEQUENCE_STORAGE_PREFIX + hashSequence(sequence), JSON.stringify({ header: name, sequence, warnings: [] }));
    } catch {
      // Sans stockage de session, l'Explorateur s'ouvre vide
    }
  };

  return (
    <div className="space-y-4">
      <ExplorerCallout href={explorerHref} onOpen={rememberSequence} />

      <section className="overflow-hidden card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="rounded-lg bg-violet-600 p-2 text-white shadow-sm">
              <GitBranch size={16} />
            </span>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-violet-700">Évolution · aperçu</p>
              <h2 className="text-[17px] font-semibold text-slate-900">Conservation des résidus</h2>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {accession && <SourceSwitch source={source} onChange={setSource} />}
            {status === "succeeded" && result && (
              <button
                onClick={() => exportCsv(fileBase, result)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download size={13} />
                Conservation (CSV)
              </button>
            )}
          </div>
        </div>

        {status !== "succeeded" || !result ? (
          <div className="p-6">
            {status === "failed" ? (
              <p className="flex items-start gap-2 text-[15px] text-rose-700">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                Analyse évolutive impossible : {error}
              </p>
            ) : (
              <div className="flex items-start gap-3 text-[15px] text-slate-600">
                <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-violet-600" />
                <div>
                  <p className="font-semibold text-slate-900">
                    {status === "running" ? "Recherche et alignement des homologues en cours…" : "Calcul en file d’attente…"}
                  </p>
                  <p className="text-[14px]">
                    {accession && source === "uniref50"
                      ? "Collecte des orthologues (UniRef50) et calcul de la conservation : quelques secondes."
                      : "Recherche d’homologues MMseqs2 dans UniRef, puis calcul de la conservation : de 20 secondes à quelques minutes."}{" "}
                    Le résultat est ensuite conservé.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Summary result={result} matched={matched?.accession ?? null} reviewed={!!matched?.reviewed} />
        )}
      </section>
    </div>
  );
}

function Summary({ result, matched, reviewed }: { result: ConservationResult; matched: string | null; reviewed: boolean }) {
  const s = result.summary;
  const tmGain = s.tm_mean_score != null && s.loop_mean_score != null ? s.tm_mean_score - s.loop_mean_score : null;

  return (
    <>
      {matched && (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[14px] text-emerald-900">
          <span>
            Séquence identique à l’entrée UniProt <span className="font-mono font-semibold">{matched}</span>
            {reviewed ? " (Swiss-Prot)" : ""} : l’analyse porte sur cette entrée.
          </span>
          <Link href={`/structures/${matched}?tab=evolution`} className="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline">
            Analyse structurale et 3D
            <ArrowRight size={14} />
          </Link>
        </div>
      )}

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Séquences alignées"
          value={`${result.sequence_count}`}
          hint={result.species_count ? `${result.species_count} espèces` : result.source === "mmseqs" ? "homologues MMseqs2" : "—"}
        />
        <Stat label="Conservation dans la membrane" value={fmt(s.tm_mean_score)} hint="score moyen des segments TM" />
        <Stat label="Conservation hors membrane" value={fmt(s.loop_mean_score)} hint="boucles et extrémités" />
        <Stat
          label="Écart membrane / boucles"
          value={tmGain == null ? "—" : `${tmGain >= 0 ? "+" : ""}${fmt(tmGain)}`}
          hint={tmGain == null ? "aucun segment TM annoté" : tmGain > 0 ? "la membrane est plus conservée" : "les boucles sont plus conservées"}
        />
      </div>

      {result.warnings.map((w) => (
        <p key={w} className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {w}
        </p>
      ))}

      <div className="border-t border-slate-100 px-4 py-3">
        <ConservationProfile positions={result.positions} tmSegments={s.tm_segments} />
        <GradeLegend />
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <p className="mb-1.5 text-[14px] font-semibold text-slate-900">Positions les plus conservées</p>
        <div className="flex flex-wrap gap-1.5">
          {s.most_conserved.map((p) => (
            <span key={p.position} className="rounded bg-[#a02560] px-2 py-0.5 font-mono text-[13px] font-semibold text-white">
              {p.residue}
              {p.position}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[13px] leading-5 text-slate-500">
          Méthode : {result.method}. Grades relatifs à la protéine (1 = 11 % des positions les plus variables, 9 = 11 %
          les plus conservées).
        </p>
      </div>
    </>
  );
}

function ExplorerCallout({ href, onOpen }: { href: string; onOpen: () => void }) {
  return (
    <Link
      href={href}
      onClick={onOpen}
      className="group flex flex-wrap items-center gap-4 rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-violet-50 p-4 hover:border-emerald-400"
    >
      <span className="rounded-lg bg-emerald-600 p-2.5 text-white shadow-sm">
        <Sparkles size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold text-slate-900">Analyse évolutive complète dans l’Explorateur</span>
        <span className="block text-[14px] text-slate-600">
          Alignement multiple, arbre phylogénétique, position des résidus dans la membrane, résidus candidats et
          coévolution. Cette page n’en montre qu’un aperçu.
        </span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-[14px] font-semibold text-white group-hover:bg-emerald-700">
        Ouvrir dans l’Explorateur
        <ArrowRight size={15} />
      </span>
    </Link>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="text-[22px] font-bold text-slate-900">{value}</p>
      <p className="text-[13px] text-slate-500">{hint}</p>
    </div>
  );
}

function GradeLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
      <span>Variable</span>
      <span className="flex overflow-hidden rounded ring-1 ring-slate-200">
        {CONSURF_COLORS.map((c, i) => (
          <span key={c} className="flex h-5 w-6 items-center justify-center text-[11px] font-semibold" style={{ backgroundColor: c, color: i >= 7 ? "white" : "#0f172a" }}>
            {i + 1}
          </span>
        ))}
      </span>
      <span>Conservé</span>
      <span className="ml-auto text-slate-400">Grades de conservation (palette ConSurf)</span>
    </div>
  );
}

function exportCsv(base: string, result: ConservationResult) {
  const header = "position,residu,grade,score,frequence_residu,fraction_gaps,residus_observes";
  const lines = result.positions.map((p) =>
    [
      p.position,
      p.residue,
      p.grade,
      p.score,
      p.query_residue_frequency,
      p.gap_fraction,
      `"${p.top_residues.map((r) => `${r.residue}:${r.frequency}`).join(" ")}"`,
    ].join(",")
  );
  downloadText(`${base}_conservation.csv`, [header, ...lines].join("\n"), "text/csv");
}

function SourceSwitch({ source, onChange }: { source: ConservationSource; onChange: (s: ConservationSource) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[13px]" role="radiogroup" aria-label="Source des homologues">
      {(
        [
          ["uniref50", "Orthologues proches", "UniRef50 : séquences à au moins 50 % d’identité, rapide"],
          ["mmseqs", "Recherche étendue", "MMseqs2 : homologues plus lointains, jusqu’à 1 000 séquences"],
        ] as const
      ).map(([key, label, title]) => (
        <button
          key={key}
          role="radio"
          aria-checked={source === key}
          title={title}
          onClick={() => onChange(key)}
          className={`rounded px-2.5 py-1 font-semibold ${source === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
