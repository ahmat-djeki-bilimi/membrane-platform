"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Waves } from "lucide-react";

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type MembraneSegment = {
  start: number;
  end: number;
  label?: string;
};

type OPMData = {
  pdb_id: string;
  available: boolean;
  url: string;
  membrane_type?: string | null;
  hydrophobic_thickness?: number | null;
  tilt_angle?: number | null;
  delta_g_transfer?: number | null;
  message?: string;
  interpretation?: string;
};

export default function OPMScientificPanel({
  pdbId,
  segments,
  activeRange,
  onFocusRange,
}: {
  pdbId?: string | null;
  segments: MembraneSegment[];
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [opm, setOpm] = useState<OPMData | null>(null);

  useEffect(() => {
    if (!pdbId) {
      setOpm(null);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/opm/${pdbId}`);
        const json = await res.json();
        setOpm(json);
      } catch (error) {
        console.error("Erreur OPM:", error);
        setOpm(null);
      }
      setLoading(false);
    };

    load();
  }, [pdbId]);

  return (
    <section className="rounded border border-blue-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves size={17} className="text-[#0f4c81]" />
          <div>
            <h2 className="text-[14px] font-bold text-slate-900">
              OPM Orientation membranaire
            </h2>
            <p className="text-[11px] text-slate-500">
              Orientation scientifique, épaisseur membranaire et topologie.
            </p>
          </div>
        </div>

        {pdbId && (
          <a
            href={`https://opm.phar.umich.edu/proteins/${pdbId.toLowerCase()}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded bg-[#0f4c81] px-3 py-1 text-[11px] font-semibold text-white"
          >
            OPM
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {loading ? (
        <div className="flex h-[180px] items-center justify-center gap-2 text-[12px] text-slate-500">
          <Loader2 size={15} className="animate-spin" />
          Chargement OPM...
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-4 gap-2">
            <MetricBox label="Statut" value={opm?.available ? "Disponible" : "À vérifier"} />
            <MetricBox label="Type" value={opm?.membrane_type || "-"} />
            <MetricBox label="Thickness" value={typeof opm?.hydrophobic_thickness === "number" ? `${opm.hydrophobic_thickness} Å` : "-"} />
            <MetricBox label="Tilt" value={typeof opm?.tilt_angle === "number" ? `${opm.tilt_angle}°` : "-"} />
          </div>

          <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-[12px] font-bold text-slate-900">Interprétation OPM</p>
            <p className="mt-1 text-[12px] leading-5 text-slate-700">
              {opm?.interpretation || "Aucune interprétation OPM disponible."}
            </p>
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-7">
              <MembraneOrientationDiagram
                pdbId={pdbId}
                segments={segments}
                thickness={opm?.hydrophobic_thickness}
                activeRange={activeRange}
                onFocusRange={onFocusRange}
              />
            </div>

            <div className="col-span-5 space-y-2">
              <div className="rounded border border-slate-200 bg-white p-3">
                <p className="text-[12px] font-bold text-slate-900">
                  Segments transmembranaires
                </p>

                <div className="mt-2 space-y-2">
                  {segments.length > 0 ? (
                    segments.map((segment, index) => (
                      <button
                        key={`${segment.start}-${segment.end}-${index}`}
                        onClick={() =>
                          onFocusRange({
                            start: segment.start,
                            end: segment.end,
                            label: segment.label || `TM${index + 1}`,
                            color: "#2563eb",
                          })
                        }
                        className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-[12px] ${
                          activeRange?.start === segment.start &&
                          activeRange?.end === segment.end
                            ? "border-blue-400 bg-blue-50 text-blue-900"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                        }`}
                      >
                        <span className="flex items-center gap-2 font-bold">
                          <span className="h-3 w-3 rounded bg-blue-600" />
                          {segment.label || `TM${index + 1}`}
                        </span>
                        <span>Résidus {segment.start}–{segment.end}</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-[12px] text-slate-500">
                      Aucun segment TM détecté.
                    </p>
                  )}
                </div>
              </div>

              {typeof opm?.delta_g_transfer === "number" && (
                <div className="rounded border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-[12px] font-bold text-emerald-900">
                    ΔG transfert membranaire
                  </p>
                  <p className="mt-1 text-[22px] font-black text-emerald-900">
                    {opm.delta_g_transfer} kcal/mol
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 truncate text-[13px] font-bold text-slate-900">{value}</p>
    </div>
  );
}

function MembraneOrientationDiagram({
  pdbId,
  segments,
  thickness,
  activeRange,
  onFocusRange,
}: {
  pdbId?: string | null;
  segments: MembraneSegment[];
  thickness?: number | null;
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  return (
    <div className="relative h-[300px] overflow-hidden rounded border border-blue-100 bg-white">
      <div className="absolute left-0 right-0 top-[22px] flex justify-between px-4 text-[11px] font-bold text-blue-900">
        <span>Extracellulaire</span>
        <span className="rounded bg-[#0f4c81] px-2 py-1 text-white">
          {pdbId || "PDB"}
        </span>
      </div>

      <div className="absolute left-0 right-0 top-[80px] h-[22px] bg-blue-100" />
      <div className="absolute left-0 right-0 bottom-[80px] h-[22px] bg-blue-100" />
      <div className="absolute left-0 right-0 top-[102px] bottom-[102px] bg-gradient-to-b from-orange-50 via-orange-100 to-orange-50" />

      <div className="absolute left-4 top-[115px] rounded bg-white/90 px-2 py-1 text-[10px] font-bold text-orange-800">
        Hydrophobic core
      </div>

      {typeof thickness === "number" && (
        <div className="absolute right-4 top-[126px] rounded bg-white/90 px-2 py-1 text-[10px] font-bold text-slate-700">
          {thickness} Å
        </div>
      )}

      <div className="absolute inset-x-0 top-[72px] flex h-[155px] items-center justify-center gap-5">
        {segments.length > 0 ? (
          segments.map((segment, index) => (
            <button
              key={`${segment.start}-${segment.end}-diagram-${index}`}
              onClick={() =>
                onFocusRange({
                  start: segment.start,
                  end: segment.end,
                  label: segment.label || `TM${index + 1}`,
                  color: "#2563eb",
                })
              }
              className={`h-[145px] w-[28px] rounded-full transition ${
                activeRange?.start === segment.start &&
                activeRange?.end === segment.end
                  ? "bg-blue-900 ring-4 ring-blue-200"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            />
          ))
        ) : (
          <p className="text-[12px] text-slate-400">Aucun segment TM détecté</p>
        )}
      </div>

      <div className="absolute bottom-[22px] left-0 right-0 px-4 text-[11px] font-bold text-blue-900">
        Cytoplasmique
      </div>
    </div>
  );
}
