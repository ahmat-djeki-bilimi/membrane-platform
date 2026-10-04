"use client";

import { Dna, Eye, Waves } from "lucide-react";

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type TMSegment = {
  start: number;
  end: number;
  label?: string;
};

export default function TransmembranePanel({
  accession,
  segments,
  activeRange,
  onFocusRange,
}: {
  accession: string;
  segments: TMSegment[];
  activeRange?: HighlightRange | null;
  onFocusRange?: (range: HighlightRange) => void;
}) {
  const hasSegments = segments.length > 0;

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Waves size={17} className="text-blue-700" />
        <div>
          <h2 className="text-[14px] font-bold text-slate-900">
            Segments transmembranaires
          </h2>
          <p className="text-[11px] text-slate-500">
            Coloration automatique des régions TM dans le viewer 3D.
          </p>
        </div>
      </div>

      {!hasSegments ? (
        <div className="rounded border border-amber-100 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900">
          Aucun segment transmembranaire détecté pour {accession}. Si la protéine
          est bien membranaire, connecte DeepTMHMM ou TMHMM côté backend pour une
          prédiction plus avancée.
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-7 rounded border border-blue-100 bg-blue-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[12px] font-bold text-blue-900">
                Carte linéaire TM
              </p>
              <span className="rounded bg-white px-2 py-1 text-[10px] font-bold text-blue-800">
                {segments.length} segment(s)
              </span>
            </div>

            <div className="space-y-2">
              {segments.map((seg, index) => (
                <button
                  key={`${seg.start}-${seg.end}`}
                  onClick={() =>
                    onFocusRange?.({
                      start: seg.start,
                      end: seg.end,
                      label: seg.label || `TM${index + 1}`,
                      color: "#2563eb",
                    })
                  }
                  className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-[12px] transition ${
                    activeRange?.start === seg.start &&
                    activeRange?.end === seg.end
                      ? "border-blue-400 bg-white text-blue-900"
                      : "border-blue-100 bg-white/70 text-slate-700 hover:bg-white"
                  }`}
                >
                  <span className="flex items-center gap-2 font-bold">
                    <span className="h-3 w-3 rounded bg-blue-600" />
                    {seg.label || `TM${index + 1}`}
                  </span>
                  <span>
                    Résidus {seg.start}–{seg.end}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="col-span-5 rounded border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Dna size={15} className="text-[#0f4c81]" />
              <p className="text-[12px] font-bold text-slate-900">
                Interprétation biologique
              </p>
            </div>

            <p className="text-[12px] leading-5 text-slate-700">
              Les segments bleus correspondent aux régions hydrophobes
              susceptibles de traverser la bicouche lipidique. Ils sont
              prioritaires pour l’analyse des protéines membranaires : récepteurs,
              canaux, transporteurs et protéines d’ancrage.
            </p>

            <div className="mt-3 rounded border border-blue-100 bg-white p-2 text-[11px] leading-5 text-blue-900">
              <b>Lecture 3D :</b> bleu = segment transmembranaire ; rouge =
              résidu Ramachandran outlier ; orange = conformation tolérée.
            </div>

            <button
              onClick={() => {
                const first = segments[0];
                if (!first) return;
                onFocusRange?.({
                  start: first.start,
                  end: first.end,
                  label: first.label || "TM segment",
                  color: "#2563eb",
                });
              }}
              className="mt-3 inline-flex items-center gap-1 rounded bg-blue-700 px-3 py-2 text-[11px] font-semibold text-white"
            >
              <Eye size={13} />
              Voir le premier segment en 3D
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
