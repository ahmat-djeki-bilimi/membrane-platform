"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileUp, Loader2, Play, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui";
import { fetchHomologFasta, previewFasta, type ExplorerRequest } from "@/lib/explorer";

const EXAMPLES = [
  { accession: "P02945", label: "Bactériorhodopsine", hint: "pompe à protons, 7 hélices" },
  { accession: "P29972", label: "Aquaporine-1", hint: "canal à eau, motifs NPA" },
  { accession: "P07550", label: "Récepteur β2-adrénergique", hint: "RCPG de classe A" },
];
const MAX_SEQUENCES = 500;

/**
 * Étape 1 : famille de protéines membranaires homologues au format FASTA
 * (collée, fichier, ou orthologues UniRef50 d'une entrée UniProt).
 */
export default function ImportPanel({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (request: ExplorerRequest) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [fasta, setFasta] = useState("");
  const [reference, setReference] = useState(0);
  const [accession, setAccession] = useState("");
  const [expand, setExpand] = useState(false);
  const [lookup, setLookup] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [loadMessage, setLoadMessage] = useState<{ tone: "emerald" | "rose"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const preview = useMemo(() => previewFasta(fasta), [fasta]);
  const count = preview.records.length;
  const referenceIndex = reference < count ? reference : 0;
  const referenceRecord = preview.records[referenceIndex];
  const problem =
    preview.error ??
    (count === 0
      ? null
      : count > MAX_SEQUENCES
        ? `Trop de séquences (${count}) : ${MAX_SEQUENCES} au maximum.`
        : count < 2 && !expand
          ? "Ajoutez au moins un homologue, ou activez la recherche étendue."
          : referenceRecord && referenceRecord.length < 20
            ? "La séquence de référence est trop courte (20 résidus minimum)."
            : referenceRecord && referenceRecord.length > 1500
              ? "La séquence de référence est trop longue (1 500 résidus maximum)."
              : null);

  const loadHomologs = async (acc: string) => {
    if (!acc.trim()) return;
    setLoading(acc);
    setLoadMessage(null);
    try {
      const data = await fetchHomologFasta(acc);
      setFasta(data.fasta);
      setReference(0);
      setAccession("");
      setLoadMessage({
        tone: "emerald",
        text: `${data.protein_name} (${data.accession}) et ${data.homolog_count} orthologue(s) UniRef50 chargés. ${
          data.homolog_count < 50 && !expand
            ? "Pour la coévolution, activez aussi la recherche étendue (centaines d’homologues)."
            : ""
        }`,
      });
    } catch (e) {
      setLoadMessage({ tone: "rose", text: e instanceof Error ? e.message : "Chargement impossible." });
    } finally {
      setLoading(null);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setFasta(String(reader.result ?? ""));
      setReference(0);
      setLoadMessage({ tone: "emerald", text: `Fichier « ${file.name} » chargé.` });
    };
    reader.readAsText(file);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-blue-700">Étape 1</p>
        <h2 className="text-[17px] font-semibold text-slate-900">Protéines membranaires homologues : importation FASTA</h2>
        <p className="text-[14px] text-slate-600">
          Collez ou importez une famille de séquences (alignées ou non). La première sert de référence, sauf choix
          contraire : toutes les positions sont numérotées sur elle.
        </p>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          <textarea
            value={fasta}
            onChange={(e) => setFasta(e.target.value)}
            spellCheck={false}
            placeholder={">sp|P02945|BACR_HALSA Bacteriorhodopsin OS=Halobacterium salinarum\nMLELLPTAVEGVSQAQITGRPEWIWLALGTALMGLGTLYFLVKG...\n>homologue_2\n..."}
            className="h-64 w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-[13px] leading-5 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              <FileUp size={14} />
              Importer un fichier
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".fasta,.fa,.faa,.fas,.aln,.afa,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
                e.target.value = "";
              }}
            />
            {fasta && (
              <button type="button" onClick={() => setFasta("")} className="rounded-md px-2 py-1.5 font-semibold text-slate-500 hover:text-slate-800">
                Effacer
              </button>
            )}
            <span className="ml-auto text-slate-500">
              {count > 0 && (
                <>
                  {count} séquence{count > 1 ? "s" : ""}
                  {preview.prealigned ? " · alignement fourni (repris tel quel)" : " · seront alignées sur la référence"}
                </>
              )}
            </span>
          </div>
          {loadMessage && (
            <p className={`rounded-md px-3 py-2 text-[13px] ${loadMessage.tone === "emerald" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
              {loadMessage.text}
            </p>
          )}
        </div>

        <div className="space-y-4 text-[14px]">
          <div className="rounded-md border border-slate-200 p-3">
            <p className="flex items-center gap-1.5 font-semibold text-slate-900">
              <Download size={14} className="text-blue-600" />
              Partir d’une entrée UniProt
            </p>
            <p className="mb-2 text-[13px] text-slate-500">La protéine et ses orthologues UniRef50 (une séquence par espèce).</p>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                loadHomologs(lookup);
              }}
            >
              <input
                value={lookup}
                onChange={(e) => setLookup(e.target.value.toUpperCase())}
                placeholder="ex. P02945"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-[13px] outline-none focus:border-blue-500"
              />
              <button
                disabled={!!loading || !lookup.trim()}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
              >
                Charger
              </button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.accession}
                  type="button"
                  disabled={!!loading}
                  onClick={() => loadHomologs(ex.accession)}
                  title={ex.hint}
                  className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[12px] font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                >
                  {loading === ex.accession ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {ex.label}
                </button>
              ))}
            </div>
            {loading && <p className="mt-2 text-[12px] text-slate-500">Collecte des orthologues (jusqu’à 30 secondes la première fois)…</p>}
          </div>

          <div className="space-y-2">
            <label className="block">
              <span className="font-semibold text-slate-900">Séquence de référence</span>
              <select
                value={referenceIndex}
                onChange={(e) => setReference(Number(e.target.value))}
                disabled={count === 0}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px] disabled:bg-slate-50"
              >
                {preview.records.slice(0, MAX_SEQUENCES).map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {r.header.slice(0, 70)} ({r.length} aa)
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-semibold text-slate-900">Accession UniProt de la référence</span>
              <span className="text-slate-500"> (facultatif)</span>
              <input
                value={accession}
                onChange={(e) => setAccession(e.target.value.toUpperCase())}
                placeholder="reconnue automatiquement si possible"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-[13px] outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex items-start gap-2 rounded-md bg-slate-50 p-2">
              <input type="checkbox" className="mt-1" checked={expand} onChange={(e) => setExpand(e.target.checked)} />
              <span>
                <span className="font-semibold text-slate-900">Recherche étendue (MMseqs2)</span>
                <span className="block text-[13px] text-slate-600">
                  Ajoute jusqu’à 1 000 homologues d’UniRef. Indispensable pour une coévolution fiable ; de 1 à 5 minutes.
                </span>
              </span>
            </label>
          </div>

          {problem && count > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{problem}</p>}
          {error && (
            <Alert tone="rose" title="Analyse impossible">
              {error}
            </Alert>
          )}

          <button
            type="button"
            disabled={count === 0 || !!problem || submitting}
            onClick={() => onSubmit({ fasta, reference: referenceIndex, accession: accession.trim() || null, expand })}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0f4c81] px-4 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-[#0b3a63] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Lancer l’analyse
          </button>
        </div>
      </div>
    </section>
  );
}
