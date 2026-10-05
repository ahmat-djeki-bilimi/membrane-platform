"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, ClipboardPaste, FileUp, X } from "lucide-react";
import { hashSequence, parseSequenceInput } from "../lib/sequence";
import { SEQUENCE_STORAGE_PREFIX } from "./SearchForm";

const EXAMPLE_FASTA = `>sp|P02945|BACR_HALSA Bacteriorhodopsin OS=Halobacterium salinarum
MLELLPTAVEGVSQAQITGRPEWIWLALGTALMGLGTLYFLVKGMGVSDPDAKKFYAITT
LVPAIAFTMYLSMLLGYGLTMVPFGGEQNPIYWARYADWLFTTPLLLLDLALLVDADQGT
ILALVGADGIMIGTGLVGALTKVYSYRFVWWAISTAAMLYILYVLFFGFTSKAESMRPEV
ASTFKVLRNVTVVLWSAYPVVWLIGSEGAGIVPLNIETLLFMVLDVSAKVGFGLILLRSR
AIFGEAEAPEPSAGDGAAATSD`;

const MAX_FILE_SIZE = 2 * 1024 * 1024;

// Bloc de collage de séquence, sur fond clair.
export default function SequencePaste({ id }: { id?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseSequenceInput(text) : null), [text]);

  const submit = () => {
    if (!parsed) return;
    if (!parsed.ok) {
      setSubmitError(parsed.error);
      return;
    }
    const key = hashSequence(parsed.value.sequence);
    try {
      sessionStorage.setItem(SEQUENCE_STORAGE_PREFIX + key, JSON.stringify(parsed.value));
    } catch {
      setSubmitError("Impossible de conserver la séquence dans ce navigateur.");
      return;
    }
    router.push(`/search?seq=${key}`);
  };

  const loadFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setSubmitError("Fichier trop volumineux (2 Mo maximum).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setSubmitError(null);
    };
    reader.onerror = () => setSubmitError("Lecture du fichier impossible.");
    reader.readAsText(file);
  };

  return (
    <section id={id} className="relative scroll-mt-16 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 via-violet-500 to-blue-600" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md bg-rose-500 p-2 text-white shadow-sm">
            <ClipboardPaste size={16} />
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-rose-700">
              Séquence protéique
            </p>
            <h2 className="text-[17px] font-semibold text-slate-900">Coller une séquence</h2>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setText(EXAMPLE_FASTA);
              setSubmitError(null);
            }}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Exemple (bactériorhodopsine)
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileUp size={13} />
            Importer un fichier
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".fasta,.fa,.faa,.fas,.txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) loadFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <textarea
            aria-label="Séquence protéique ou FASTA"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSubmitError(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) loadFile(file);
            }}
            placeholder={
              "Collez une séquence protéique (brute ou FASTA), ou glissez-déposez un fichier .fasta\n\n>ma_proteine\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ..."
            }
            rows={7}
            spellCheck={false}
            className={`w-full resize-y rounded-md border bg-slate-50 px-3 py-2 font-mono text-[14px] leading-5 text-slate-900 outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:bg-white focus:ring-2 ${
              dragging
                ? "border-rose-400 bg-rose-50 ring-2 ring-rose-100"
                : parsed && !parsed.ok
                ? "border-red-300 focus:ring-red-100"
                : "border-slate-300 focus:border-rose-400 focus:ring-rose-100"
            }`}
          />
          {text && (
            <button
              type="button"
              onClick={() => {
                setText("");
                setSubmitError(null);
              }}
              className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label="Effacer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-h-[20px] text-[14px]" aria-live="polite">
            {submitError || (parsed && !parsed.ok) ? (
              <span className="flex items-center gap-1.5 text-red-600">
                <AlertCircle size={13} />
                {submitError ?? (parsed && !parsed.ok ? parsed.error : "")}
              </span>
            ) : parsed && parsed.ok ? (
              <span className="flex flex-wrap items-center gap-1.5 text-emerald-700">
                <CheckCircle2 size={13} />
                <span className="font-semibold">
                  {parsed.value.sequence.length.toLocaleString("fr-FR")} résidus
                </span>
                {parsed.value.header && (
                  <span className="max-w-[320px] truncate text-slate-500">· {parsed.value.header}</span>
                )}
                {parsed.value.warnings.length > 0 && (
                  <span className="text-amber-700">
                    · {parsed.value.warnings.length} remarque{parsed.value.warnings.length > 1 ? "s" : ""}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-slate-500">
                Formats acceptés : séquence brute, FASTA, numéros et espaces ignorés.
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={!parsed || !parsed.ok}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-rose-500 to-violet-600 px-4 py-2 text-[15px] font-semibold text-white shadow-sm transition hover:from-rose-400 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Analyser la séquence
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </section>
  );
}
