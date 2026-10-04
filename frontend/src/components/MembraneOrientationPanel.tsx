"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck, Waves } from "lucide-react";
import Membrane3DViewer from "@/components/Membrane3DViewer";

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
  source?: string;
  confidence?: string;
  hydrophobic_score?: number;
};

type OrientationData = {
  tm_count: number;
  topology: string;
  orientation_confidence: number;
  estimated_hydrophobic_thickness?: number | null;
  extracellular_side?: string;
  cytoplasmic_side?: string;
  interpretation?: string;
};

type MembraneOrientationResponse = {
  accession: string;
  available: boolean;
  sequence_length: number;
  method: string;
  tm_segments: TMSegment[];
  orientation: OrientationData;
  opm_role?: string;
  opm_url?: string;
  error?: string;
};

const TM_COLORS = [
  "#ef4444",
  "#f97316",
  "#dc2626",
  "#fb923c",
  "#b91c1c",
  "#ea580c",
  "#991b1b",
];

export default function MembraneOrientation3DPanel({
  accession,
  pdbId,
  pdbUrl,
  activeRange,
  onFocusRange,
}: {
  accession: string;
  pdbId?: string | null;
  pdbUrl?: string | null;
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MembraneOrientationResponse | null>(null);

  useEffect(() => {
    if (!accession) return;

    const load = async () => {
      setLoading(true);

      try {
        const res = await fetch(
          `http://127.0.0.1:8000/api/membrane-orientation/${accession}`
        );
        const json = await res.json();
        setData(json);
      } catch (error) {
        console.error("Erreur orientation membranaire:", error);
        setData(null);
      }

      setLoading(false);
    };

    load();
  }, [accession]);

  const segments = data?.tm_segments || [];
  const orientation = data?.orientation;

  const proteinType = useMemo(() => {
    const count = orientation?.tm_count || segments.length;

    if (count >= 7) return "Récepteur 7TM / GPCR-like";
    if (count > 1) return "Protéine multipasse transmembranaire";
    if (count === 1) return "Protéine single-pass";
    return "Aucune région TM détectée";
  }, [orientation?.tm_count, segments.length]);

  const opmUrl =
    data?.opm_url ||
    (pdbId ? `https://opm.phar.umich.edu/proteins/${pdbId.toLowerCase()}` : "");

  return (
    <section className="rounded border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-[#f8fafc] px-4 py-3">
        <div className="flex items-center gap-2">
          <Waves size={18} className="text-[#0f4c81]" />
          <div>
            <h2 className="text-[14px] font-bold text-slate-900">
              Orientation membranaire
            </h2>
            <p className="text-[11px] text-slate-500">
              Topologie UniProt · segments TM · visualisation 3D · référence OPM.
            </p>
          </div>
        </div>

        {opmUrl && (
          <a
            href={opmUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded bg-[#0f4c81] px-3 py-1 text-[11px] font-semibold text-white"
          >
            Consulter OPM
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {loading ? (
        <div className="flex h-[620px] items-center justify-center gap-2 text-[12px] text-slate-500">
          <Loader2 size={15} className="animate-spin" />
          Chargement de l’orientation membranaire...
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3 p-4">
          <div className="col-span-7 space-y-3">
            <TopologySummary
              accession={accession}
              proteinType={proteinType}
              method={data?.method}
              sequenceLength={data?.sequence_length}
              orientation={orientation}
              tmCount={segments.length}
            />

            <TopologyDiagram
              segments={segments}
              topology={orientation?.topology || "-"}
              activeRange={activeRange}
              onFocusRange={onFocusRange}
            />

            <Membrane3DViewer
              pdbId={pdbId}
              pdbUrl={pdbUrl}
              segments={segments}
              activeRange={activeRange}
            />
          </div>

          <div className="col-span-5 space-y-3">
            <TMTable
              segments={segments}
              activeRange={activeRange}
              onFocusRange={onFocusRange}
            />

            <OPMValidationCard
              pdbId={pdbId}
              opmUrl={opmUrl}
              opmRole={data?.opm_role}
              method={data?.method}
              orientation={orientation}
            />

            <InterpretationCard
              interpretation={orientation?.interpretation}
              tmCount={orientation?.tm_count || segments.length}
              topology={orientation?.topology}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function TopologySummary({
  accession,
  proteinType,
  method,
  sequenceLength,
  orientation,
  tmCount,
}: {
  accession: string;
  proteinType: string;
  method?: string;
  sequenceLength?: number;
  orientation?: OrientationData;
  tmCount: number;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className="text-[#0f4c81]" />
        <div>
          <p className="text-[13px] font-bold text-slate-900">
            Résumé topologique
          </p>
          <p className="text-[11px] text-slate-500">
            Synthèse automatique de l’orientation membranaire.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MetricBox label="UniProt" value={accession} />
        <MetricBox label="Type" value={proteinType} />
        <MetricBox label="Méthode" value={method || "-"} />
        <MetricBox label="Longueur" value={sequenceLength ? `${sequenceLength} aa` : "-"} />
        <MetricBox label="Hélices TM" value={`${orientation?.tm_count ?? tmCount}`} />
        <MetricBox label="Topologie" value={orientation?.topology || "-"} />
        <MetricBox
          label="Confiance"
          value={`${orientation?.orientation_confidence ?? 0}%`}
        />
        <MetricBox
          label="Épaisseur"
          value={
            typeof orientation?.estimated_hydrophobic_thickness === "number"
              ? `≈ ${orientation.estimated_hydrophobic_thickness} Å`
              : "-"
          }
        />
        <MetricBox
          label="Côtés"
          value={
            orientation?.extracellular_side && orientation?.cytoplasmic_side
              ? "N/C définis"
              : "-"
          }
        />
      </div>
    </div>
  );
}

function TopologyDiagram({
  segments,
  topology,
  activeRange,
  onFocusRange,
}: {
  segments: TMSegment[];
  topology: string;
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  const nSide = topology.toLowerCase().includes("n-out")
    ? "N-ter extracellulaire"
    : "N-ter";

  const cSide = topology.toLowerCase().includes("c-in")
    ? "C-ter cytoplasmique"
    : topology.toLowerCase().includes("c-out")
    ? "C-ter extracellulaire"
    : "C-ter";

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-bold text-slate-900">
            Schéma topologique
          </p>
          <p className="text-[11px] text-slate-500">
            Représentation simplifiée type GPCR/OPM.
          </p>
        </div>

        <span className="rounded bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-900">
          {topology}
        </span>
      </div>

      <div className="relative overflow-hidden rounded border border-slate-200 bg-[#f8fafc] p-4">
        <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-blue-900">
          <span>{nSide}</span>
          <span>Milieu extracellulaire</span>
        </div>

        <div className="relative h-[230px] rounded bg-white">
          <div className="absolute left-0 right-0 top-[55px] h-[30px] bg-blue-100" />
          <div className="absolute left-0 right-0 bottom-[55px] h-[30px] bg-blue-100" />
          <div className="absolute left-0 right-0 top-[85px] bottom-[85px] bg-orange-100" />

          <div className="absolute left-3 top-[61px] rounded bg-white px-2 py-1 text-[10px] font-bold text-blue-900 shadow-sm">
            Feuillet externe
          </div>

          <div className="absolute left-3 bottom-[61px] rounded bg-white px-2 py-1 text-[10px] font-bold text-blue-900 shadow-sm">
            Feuillet interne
          </div>

          <div className="absolute left-1/2 top-[105px] -translate-x-1/2 rounded bg-white px-2 py-1 text-[10px] font-bold text-orange-900 shadow-sm">
            Noyau hydrophobe
          </div>

          <div className="absolute inset-x-0 top-[45px] flex h-[140px] items-center justify-center gap-3 px-4">
            {segments.length > 0 ? (
              segments.map((segment, index) => {
                const color = TM_COLORS[index % TM_COLORS.length];
                const active =
                  activeRange?.start === segment.start &&
                  activeRange?.end === segment.end;

                return (
                  <button
                    key={`${segment.start}-${segment.end}-${index}`}
                    onClick={() =>
                      onFocusRange({
                        start: segment.start,
                        end: segment.end,
                        label: segment.label || `TM${index + 1}`,
                        color,
                      })
                    }
                    className="relative flex flex-col items-center"
                    title={`${segment.label || `TM${index + 1}`} ${segment.start}-${segment.end}`}
                  >
                    <span
                      className={`block h-[132px] w-7 rounded-full shadow-md transition ${
                        active ? "ring-4 ring-orange-200" : ""
                      }`}
                      style={{ backgroundColor: color }}
                    />
                    <span className="mt-1 rounded bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-700 shadow-sm">
                      {segment.label || `TM${index + 1}`}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="rounded bg-white px-3 py-2 text-[12px] text-slate-500 shadow-sm">
                Aucun segment transmembranaire détecté.
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] font-bold text-blue-900">
          <span>Milieu intracellulaire / cytoplasmique</span>
          <span>{cSide}</span>
        </div>
      </div>
    </div>
  );
}

function TMTable({
  segments,
  activeRange,
  onFocusRange,
}: {
  segments: TMSegment[];
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-[13px] font-bold text-slate-900">
          Hélices transmembranaires
        </p>
        <p className="text-[11px] text-slate-500">
          Positions issues des annotations UniProt ou de la prédiction.
        </p>
      </div>

      <div className="max-h-[360px] overflow-auto">
        {segments.length > 0 ? (
          segments.map((segment, index) => {
            const color = TM_COLORS[index % TM_COLORS.length];
            const active =
              activeRange?.start === segment.start &&
              activeRange?.end === segment.end;

            const length = segment.end - segment.start + 1;

            return (
              <button
                key={`${segment.start}-${segment.end}-tm-table-${index}`}
                onClick={() =>
                  onFocusRange({
                    start: segment.start,
                    end: segment.end,
                    label: segment.label || `TM${index + 1}`,
                    color,
                  })
                }
                className={`grid w-full grid-cols-12 items-center gap-2 border-b px-3 py-2 text-left text-[12px] last:border-b-0 ${
                  active
                    ? "bg-orange-50 text-orange-900"
                    : "bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="col-span-3 flex items-center gap-2 font-bold">
                  <span
                    className="h-3 w-3 rounded"
                    style={{ backgroundColor: color }}
                  />
                  {segment.label || `TM${index + 1}`}
                </span>

                <span className="col-span-3 font-semibold">
                  {segment.start}–{segment.end}
                </span>

                <span className="col-span-2">{length} aa</span>

                <span className="col-span-2 text-[11px]">
                  {segment.confidence || "-"}
                </span>

                <span className="col-span-2 truncate text-[10px] text-slate-500">
                  {segment.source || "-"}
                </span>
              </button>
            );
          })
        ) : (
          <p className="p-3 text-[12px] text-slate-500">
            Aucun segment TM détecté pour cette protéine.
          </p>
        )}
      </div>
    </div>
  );
}

function OPMValidationCard({
  pdbId,
  opmUrl,
  opmRole,
  method,
  orientation,
}: {
  pdbId?: string | null;
  opmUrl?: string;
  opmRole?: string;
  method?: string;
  orientation?: OrientationData;
}) {
  return (
    <div className="rounded border border-blue-100 bg-blue-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-bold text-blue-950">
            Référence OPM
          </p>
          <p className="text-[11px] text-blue-800">
            Source externe de validation lorsque l’entrée PDB existe.
          </p>
        </div>

        {opmUrl && (
          <a
            href={opmUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded bg-[#0f4c81] px-2 py-1 text-[10px] font-bold text-white"
          >
            OPM
            <ExternalLink size={11} />
          </a>
        )}
      </div>

      <div className="space-y-1">
        <InfoLine label="PDB" value={pdbId || "-"} />
        <InfoLine label="Rôle" value={opmRole || "External validation source"} />
        <InfoLine label="Méthode" value={method || "-"} />
        <InfoLine label="Topologie" value={orientation?.topology || "-"} />
        <InfoLine
          label="Épaisseur"
          value={
            typeof orientation?.estimated_hydrophobic_thickness === "number"
              ? `≈ ${orientation.estimated_hydrophobic_thickness} Å`
              : "-"
          }
        />
      </div>
    </div>
  );
}

function InterpretationCard({
  interpretation,
  tmCount,
  topology,
}: {
  interpretation?: string;
  tmCount: number;
  topology?: string;
}) {
  return (
    <div className="rounded border border-orange-100 bg-orange-50 p-3">
      <p className="text-[13px] font-bold text-orange-950">
        Interprétation biologique
      </p>

      <p className="mt-2 text-[12px] leading-5 text-orange-900">
        {interpretation ||
          `${tmCount} segment(s) transmembranaire(s) ont été détectés. La topologie prédite est ${topology || "-"}.`}
      </p>

      <p className="mt-3 rounded bg-white/70 p-2 text-[11px] leading-5 text-orange-900">
        Cette orientation est une estimation bioinformatique basée sur les
        annotations transmembranaires et les régions hydrophobes. L’entrée OPM
        officielle reste la référence externe pour confirmer l’orientation
        exacte dans la membrane.
      </p>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 truncate text-[12px] font-black text-slate-900">
        {value}
      </p>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 rounded bg-white/70 px-2 py-1 text-[11px]">
      <span className="text-blue-800">{label}</span>
      <span className="truncate text-right font-bold text-blue-950">
        {value}
      </span>
    </div>
  );
}
