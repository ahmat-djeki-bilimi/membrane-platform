"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Loader2,
  ShieldCheck,
  Waves,
} from "lucide-react";

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type RamaPoint = {
  chain: string;
  resi: number;
  resn: string;
  phi: number;
  psi: number;
  status: "favored" | "allowed" | "outlier";
};

type QualityData = {
  pdb_id: string;
  ramachandran: {
    favored_percent: number | null;
    allowed_percent: number | null;
    outliers_percent: number | null;
    status: "excellent" | "good" | "medium" | "poor" | "unknown";
    interpretation: string;
    points: RamaPoint[];
    highlight_ranges: HighlightRange[];
  };
  geometry: {
    clashscore: number | null;
    sidechain_outliers_percent: number | null;
    rsrz_outliers_percent: number | null;
    rcsb_ramachandran_outliers_percent: number | null;
  };
  opm: {
    available: boolean;
    url: string;
    interpretation: string;
    highlight_ranges: HighlightRange[];
  };
  errat: {
    available: boolean;
    score: number | null;
    interpretation: string;
  };
  error?: string;
};

export default function StructureQualityPanel({
  pdbId,
  activeRange,
  onFocusRange,
  onClearFocus,
}: {
  pdbId?: string | null;
  activeRange?: HighlightRange | null;
  onFocusRange?: (range: HighlightRange) => void;
  onClearFocus?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<QualityData | null>(null);
  const [manualErrat, setManualErrat] = useState<string>("");

  useEffect(() => {
    if (!pdbId) {
      setData(null);
      return;
    }

    const load = async () => {
      setLoading(true);

      try {
        const res = await fetch(`http://127.0.0.1:8000/api/quality/${pdbId}`);
        const json = await res.json();
        setData(json);
      } catch (error) {
        console.error("Erreur quality:", error);
        setData(null);
      }

      setLoading(false);
    };

    load();
  }, [pdbId]);

  const erratScore = useMemo(() => {
    const backendScore = data?.errat?.score;
    if (typeof backendScore === "number") return backendScore;

    const parsed = Number(manualErrat);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;

    return null;
  }, [data, manualErrat]);

  if (!pdbId) {
    return (
      <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <Header />
        <div className="rounded border border-amber-100 bg-amber-50 p-3 text-[12px] text-amber-900">
          Sélectionne une structure PDB pour afficher OPM, Ramachandran et ERRAT.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <Header />

      {loading && (
        <div className="flex items-center gap-2 rounded border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-800">
          <Loader2 size={15} className="animate-spin" />
          Calcul réel Ramachandran + chargement OPM/validation...
        </div>
      )}

      {!loading && data && (
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-4 rounded border border-blue-100 bg-blue-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Waves size={16} className="text-blue-800" />
                <p className="text-[12px] font-bold text-blue-900">
                  OPM — orientation membranaire
                </p>
              </div>

              <a
                href={data.opm.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded bg-blue-700 px-2 py-1 text-[10px] font-semibold text-white"
              >
                OPM
                <ExternalLink size={11} />
              </a>
            </div>

            <OPMMembraneView pdbId={data.pdb_id} />

            <p className="mt-2 text-[12px] leading-5 text-blue-900">
              {data.opm.interpretation}
            </p>
          </div>

          <div className="col-span-4 rounded border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-[#0f4c81]" />
                <p className="text-[12px] font-bold text-slate-900">
                  Ramachandran réel
                </p>
              </div>

              <StatusBadge status={data.ramachandran.status} />
            </div>

            <RamachandranRealPlot
              points={data.ramachandran.points}
              onFocusRange={onFocusRange}
            />

            <div className="mt-2 rounded bg-white p-2">
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <InfoMini
                  label="Favored"
                  value={
                    data.ramachandran.favored_percent !== null
                      ? `${data.ramachandran.favored_percent}%`
                      : "-"
                  }
                />
                <InfoMini
                  label="Allowed"
                  value={
                    data.ramachandran.allowed_percent !== null
                      ? `${data.ramachandran.allowed_percent}%`
                      : "-"
                  }
                />
                <InfoMini
                  label="Outliers"
                  value={
                    data.ramachandran.outliers_percent !== null
                      ? `${data.ramachandran.outliers_percent}%`
                      : "-"
                  }
                />
              </div>

              <p className="mt-2 text-[12px] leading-5 text-slate-600">
                {data.ramachandran.interpretation}
              </p>

              {data.ramachandran.highlight_ranges.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.ramachandran.highlight_ranges.slice(0, 8).map((range, idx) => (
                    <button
                      key={`${range.start}-${range.end}-${idx}`}
                      onClick={() => onFocusRange?.(range)}
                      className={`rounded border px-2 py-1 text-[10px] font-semibold ${
                        activeRange?.start === range.start &&
                        activeRange?.end === range.end
                          ? "border-red-300 bg-red-50 text-red-800"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                      }`}
                    >
                      {range.label}: {range.start}-{range.end}
                    </button>
                  ))}

                  {onClearFocus && (
                    <button
                      onClick={onClearFocus}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
                    >
                      reset 3D
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="col-span-4 rounded border border-amber-100 bg-amber-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Gauge size={16} className="text-amber-800" />
              <p className="text-[12px] font-bold text-amber-900">
                ERRAT — score global
              </p>
            </div>

            <ERRATGauge score={erratScore} />

            <div className="mt-2 rounded bg-white p-2">
              <label className="text-[11px] font-semibold text-slate-600">
                Score ERRAT manuel
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={manualErrat}
                onChange={(e) => setManualErrat(e.target.value)}
                placeholder="ex: 85"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-amber-400"
              />
            </div>

            <p className="mt-2 text-[12px] leading-5 text-amber-900">
              {erratScore !== null
                ? interpretErrat(erratScore)
                : data.errat.interpretation}
            </p>
          </div>

          <div className="col-span-12 rounded border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <Activity size={16} className="text-slate-700" />
              <p className="text-[12px] font-bold text-slate-900">
                Géométrie structurelle wwPDB
              </p>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <GeometryMetric
                label="Clashscore"
                value={data.geometry.clashscore}
                max={50}
                suffix=""
                goodBelow={10}
              />

              <GeometryMetric
                label="Sidechain outliers"
                value={data.geometry.sidechain_outliers_percent}
                max={20}
                suffix="%"
                goodBelow={2}
              />

              <GeometryMetric
                label="RSRZ outliers"
                value={data.geometry.rsrz_outliers_percent}
                max={20}
                suffix="%"
                goodBelow={5}
              />

              <GeometryMetric
                label="RCSB Rama outliers"
                value={data.geometry.rcsb_ramachandran_outliers_percent}
                max={10}
                suffix="%"
                goodBelow={2}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Header() {
  return (
    <div className="mb-3 flex items-center gap-2">
      <ShieldCheck size={17} className="text-[#0f4c81]" />
      <div>
        <h2 className="text-[14px] font-bold text-slate-900">
          Validation structurale réelle : OPM · Ramachandran · ERRAT
        </h2>
        <p className="text-[11px] text-slate-500">
          Angles φ/ψ calculés depuis le PDB, visualisation membranaire et liaison directe avec le viewer 3D.
        </p>
      </div>
    </div>
  );
}

function OPMMembraneView({ pdbId }: { pdbId: string }) {
  return (
    <div className="relative h-[170px] overflow-hidden rounded border border-blue-100 bg-white">
      <div className="absolute left-0 right-0 top-[38px] h-[18px] bg-blue-100" />
      <div className="absolute left-0 right-0 bottom-[38px] h-[18px] bg-blue-100" />
      <div className="absolute left-0 right-0 top-[55px] h-[76px] bg-gradient-to-b from-orange-50 via-orange-100 to-orange-50" />
      <div className="absolute left-4 right-4 top-[50%] h-[2px] -translate-y-1/2 border-t border-dashed border-slate-300" />

      <div className="absolute left-[42%] top-[26px] h-[118px] w-[54px] rounded-full border-2 border-blue-700 bg-blue-500/15 shadow-sm" />
      <div className="absolute left-[47%] top-[42px] h-[86px] w-[20px] rounded-full bg-blue-700/80" />
      <div className="absolute left-[51%] top-[50px] h-[70px] w-[16px] rounded-full bg-cyan-500/80" />

      <div className="absolute left-3 top-2 rounded bg-white/90 px-2 py-1 text-[10px] font-semibold text-blue-900">
        Extracellulaire
      </div>

      <div className="absolute bottom-2 left-3 rounded bg-white/90 px-2 py-1 text-[10px] font-semibold text-blue-900">
        Cytoplasmique
      </div>

      <div className="absolute right-3 top-2 rounded bg-blue-700 px-2 py-1 text-[10px] font-bold text-white">
        {pdbId}
      </div>

      <div className="absolute bottom-2 right-3 rounded bg-orange-100 px-2 py-1 text-[10px] font-semibold text-orange-900">
        Bicouche lipidique
      </div>
    </div>
  );
}

function RamachandranRealPlot({
  points,
  onFocusRange,
}: {
  points: RamaPoint[];
  onFocusRange?: (range: HighlightRange) => void;
}) {
  const sampledPoints = points.length > 450 ? points.filter((_, i) => i % 2 === 0) : points;

  return (
    <div className="relative h-[170px] rounded border border-slate-200 bg-white">
      <div className="absolute left-[18%] top-[18%] h-[34%] w-[34%] rounded-full bg-emerald-100" />
      <div className="absolute right-[14%] bottom-[16%] h-[32%] w-[32%] rounded-full bg-emerald-100" />
      <div className="absolute left-[35%] bottom-[8%] h-[22%] w-[22%] rounded-full bg-blue-100" />

      <div className="absolute left-6 right-3 top-1/2 border-t border-slate-300" />
      <div className="absolute bottom-5 top-3 left-1/2 border-l border-slate-300" />

      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-slate-500">
        φ phi
      </div>
      <div className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-semibold text-slate-500">
        ψ psi
      </div>

      {sampledPoints.map((point, i) => {
        const x = ((point.phi + 180) / 360) * 100;
        const y = ((180 - point.psi) / 360) * 100;

        const color =
          point.status === "favored"
            ? "bg-emerald-600"
            : point.status === "allowed"
            ? "bg-amber-500"
            : "bg-red-500";

        return (
          <button
            key={`${point.chain}-${point.resi}-${i}`}
            onClick={() =>
              onFocusRange?.({
                start: point.resi,
                end: point.resi,
                label: `Rama ${point.status} ${point.resn}${point.resi}`,
                color: point.status === "outlier" ? "#ef4444" : "#f59e0b",
              })
            }
            className={`absolute h-2 w-2 rounded-full ${color} ring-1 ring-white hover:scale-150`}
            style={{ left: `${x}%`, top: `${y}%` }}
            title={`${point.resn}${point.resi} φ=${point.phi} ψ=${point.psi} ${point.status}`}
          />
        );
      })}

      <div className="absolute right-2 top-2 rounded bg-white/90 px-2 py-1 text-[10px]">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600" />
        Favored
        <span className="ml-2 mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />
        Allowed
        <span className="ml-2 mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
        Outlier
      </div>
    </div>
  );
}

function ERRATGauge({ score }: { score: number | null }) {
  const safeScore = score === null ? 0 : Math.max(0, Math.min(100, score));

  return (
    <div className="rounded border border-amber-100 bg-white p-3">
      <div className="mb-2 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Quality factor
          </p>
          <p className="text-[26px] font-bold text-amber-800">
            {score === null ? "-" : safeScore}
          </p>
        </div>

        <span className={`rounded px-2 py-1 text-[10px] font-bold ${erratStatusClass(safeScore, score)}`}>
          {score === null ? "à importer" : erratLabel(safeScore)}
        </span>
      </div>

      <div className="h-3 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${erratBarColor(safeScore, score)}`}
          style={{ width: `${score === null ? 0 : safeScore}%` }}
        />
      </div>

      <div className="mt-1 flex justify-between text-[9px] font-semibold text-slate-500">
        <span>0</span>
        <span>50</span>
        <span>80</span>
        <span>100</span>
      </div>
    </div>
  );
}

function GeometryMetric({
  label,
  value,
  max,
  suffix,
  goodBelow,
}: {
  label: string;
  value: number | null;
  max: number;
  suffix: string;
  goodBelow: number;
}) {
  const percent =
    value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

  const good = value !== null && value <= goodBelow;

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold text-slate-800">{label}</p>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
            value === null
              ? "bg-slate-200 text-slate-600"
              : good
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {value === null ? "NA" : good ? "bon" : "à vérifier"}
        </span>
      </div>

      <p className="text-[20px] font-bold text-slate-900">
        {value !== null ? `${value}${suffix}` : "-"}
      </p>

      <div className="mt-2 h-2 rounded-full bg-slate-200">
        <div
          className={`h-2 rounded-full ${
            value === null
              ? "bg-slate-300"
              : good
              ? "bg-emerald-500"
              : "bg-amber-500"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function InfoMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 p-2 text-center">
      <p className="text-[10px] font-semibold text-slate-500">{label}</p>
      <p className="text-[12px] font-bold text-slate-900">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const positive = status === "excellent" || status === "good";

  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold ${statusClass(status)}`}>
      {positive ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
      {status}
    </span>
  );
}

function statusClass(status: string) {
  if (status === "excellent") return "bg-emerald-100 text-emerald-800";
  if (status === "good") return "bg-blue-100 text-blue-800";
  if (status === "medium") return "bg-amber-100 text-amber-800";
  if (status === "poor") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

function erratLabel(score: number) {
  if (score >= 80) return "bon";
  if (score >= 50) return "moyen";
  return "faible";
}

function erratStatusClass(score: number, original: number | null) {
  if (original === null) return "bg-slate-100 text-slate-700";
  if (score >= 80) return "bg-emerald-100 text-emerald-800";
  if (score >= 50) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

function erratBarColor(score: number, original: number | null) {
  if (original === null) return "bg-slate-300";
  if (score >= 80) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function interpretErrat(score: number) {
  if (score >= 80) {
    return "Score ERRAT élevé : la qualité globale du modèle est généralement considérée comme bonne.";
  }

  if (score >= 50) {
    return "Score ERRAT moyen : la structure reste exploitable mais certaines régions doivent être vérifiées.";
  }

  return "Score ERRAT faible : le modèle doit être inspecté avec prudence, surtout pour les interactions non-liées.";
}
