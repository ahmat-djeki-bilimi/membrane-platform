"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Search } from "lucide-react";
import {
  EXAMPLE_ACCESSIONS,
  isValidAccession,
  normalizeAccession,
} from "../lib/uniprot";
import { hashSequence, parseSequenceInput } from "../lib/sequence";

export type SearchMode = "accession" | "sequence";

export const SEQUENCE_STORAGE_PREFIX = "memprot:seq:";

// Recherche par accession UniProt ou par séquence collée (brute ou FASTA).
// Prévu pour un fond sombre.
export default function SearchForm({
  initialMode = "accession",
  initialValue = "",
  showExamples = true,
}: {
  initialMode?: SearchMode;
  initialValue?: string;
  showExamples?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [accession, setAccession] = useState(initialMode === "accession" ? initialValue : "");
  const [sequenceText, setSequenceText] = useState(initialMode === "sequence" ? initialValue : "");
  const [error, setError] = useState<string | null>(null);

  const searchAccession = (value: string) => {
    const acc = normalizeAccession(value);
    if (!acc) return;
    if (!isValidAccession(acc)) {
      const looksLikeSequence = acc.replace(/\s/g, "").length >= 20;
      setError(
        looksLikeSequence
          ? "Ceci ressemble à une séquence : utilisez l’onglet « Séquence / FASTA »."
          : "Format d’accession UniProt invalide (ex. P07550)."
      );
      return;
    }
    setError(null);
    setAccession(acc);
    router.push(`/search?q=${encodeURIComponent(acc)}`);
  };

  const searchSequence = () => {
    const parsed = parseSequenceInput(sequenceText);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const id = hashSequence(parsed.value.sequence);
    try {
      sessionStorage.setItem(SEQUENCE_STORAGE_PREFIX + id, JSON.stringify(parsed.value));
    } catch {
      setError("Impossible de conserver la séquence dans ce navigateur.");
      return;
    }
    setError(null);
    router.push(`/search?seq=${id}`);
  };

  const switchMode = (next: SearchMode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div>
      <div role="tablist" aria-label="Type de recherche" className="mb-2 inline-flex rounded-md bg-white/10 p-0.5">
        {(
          [
            ["accession", "Accession UniProt"],
            ["sequence", "Séquence / FASTA"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => switchMode(key)}
            className={`rounded px-3 py-1 text-[14px] font-semibold transition ${
              mode === key ? "bg-white text-[#0f4c81] shadow-sm" : "text-blue-100 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "accession") searchAccession(accession);
          else searchSequence();
        }}
      >
        {mode === "accession" ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                aria-label="Accession UniProtKB"
                value={accession}
                onChange={(e) => {
                  setAccession(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Accession UniProtKB, ex. P07550"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!error}
                className={inputClass(!!error, "py-2.5 pl-9 pr-3")}
              />
            </div>
            <SubmitButton />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              aria-label="Séquence protéique ou FASTA"
              value={sequenceText}
              onChange={(e) => {
                setSequenceText(e.target.value);
                if (error) setError(null);
              }}
              placeholder={">ma_proteine\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ..."}
              rows={4}
              spellCheck={false}
              aria-invalid={!!error}
              className={inputClass(!!error, "resize-y px-3 py-2 text-[14px] leading-5")}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-blue-200">
                Séquence brute ou FASTA · espaces et numéros ignorés · seule la première
                séquence d’un FASTA multiple est analysée.
              </p>
              <SubmitButton />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[14px] text-red-200">
            <AlertCircle size={13} />
            {error}
          </p>
        )}
      </form>

      {showExamples && mode === "accession" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[14px]">
          <span className="mr-1 text-blue-200">Exemples :</span>
          {EXAMPLE_ACCESSIONS.map((ex) => (
            <button
              key={ex.accession}
              type="button"
              onClick={() => searchAccession(ex.accession)}
              className="rounded border border-white/20 bg-white/10 px-2 py-1 text-white transition hover:border-cyan-300/60 hover:bg-white/20"
              title={ex.name}
            >
              <span className="font-mono font-semibold">{ex.accession}</span>
              <span className="ml-1.5 text-blue-100">{ex.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function inputClass(hasError: boolean, extra: string) {
  return `w-full rounded-md border bg-white font-mono text-[16px] text-slate-900 outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:ring-2 ${extra} ${
    hasError ? "border-red-400 focus:ring-red-300/50" : "border-transparent focus:ring-cyan-300/60"
  }`;
}

function SubmitButton() {
  return (
    <button
      type="submit"
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-cyan-500 to-emerald-500 px-5 py-2.5 text-[15px] font-semibold text-white shadow-lg shadow-cyan-900/30 transition hover:from-cyan-400 hover:to-emerald-400"
    >
      Lancer l’analyse
      <ArrowRight size={15} />
    </button>
  );
}
