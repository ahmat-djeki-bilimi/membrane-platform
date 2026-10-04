"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import StructureQualityPanel from "@/components/StructureQualityPanel";
import StructuralInterpretation from "@/components/StructuralInterpretation";
import StructuralDomains from "@/components/StructuralDomains";
import AutoScientificInterpretation from "@/components/AutoScientificInterpretation";
import ActiveSitePanel from "@/components/ActiveSitePanel";
import MultiStructureComparison from "@/components/MultiStructureComparison";
import MembraneOrientationPanel from "@/components/MembraneOrientationPanel";

import {
  ArrowLeft,
  Brain,
  Cpu,
  Database,
  Dna,
  Download,
  ExternalLink,
  Eye,
  Layers3,
  Loader2,
  Microscope,
  RefreshCw,
  ShieldCheck,
  Waves,
} from "lucide-react";

const Structure3DViewer = dynamic(
  () => import("@/components/Structure3DViewer"),
  { ssr: false }
);

type ExperimentalSnapshot = {
  method?: string;
  resolution?: number | null;
  r_free?: number | null;
  r_work?: number | null;
  release_date?: string;
  starting_model?: string;
};

type ValidationData = {
  clashscore?: number | null;
  ramachandran_outliers?: number | null;
  sidechain_outliers?: number | null;
  rsrz_outliers?: number | null;
};

type Macromolecule = {
  entity_id: string;
  molecule: string;
  chains: string[];
  sequence_length: number | string;
  organism: string;
  details: string;
  image_url?: string;
};

type PDBStructure = {
  pdb_id: string;
  title: string;
  method: string;
  resolution: number | null;
  release_date: string;
  viewer_url?: string;
  experimental_snapshot?: ExperimentalSnapshot;
  validation?: ValidationData;
  macromolecules?: Macromolecule[];
};

type PDBResponse = {
  accession?: string;
  count: number;
  structures: PDBStructure[];
  error?: string;
};

type MembraneSegment = {
  start: number;
  end: number;
  label?: string;
};

type MembraneData = {
  accession?: string;
  is_membrane?: boolean;
  predicted_type?: string;
  tm_segments?: MembraneSegment[];
  error?: string;
};

type AlphaFoldData = {
  accession?: string;
  available: boolean;
  model_id?: string;
  alphafold_id?: string;
  protein_name?: string;
  organism?: string;
  gene?: string;
  sequence?: string;
  sequence_length?: number;
  pdb_url?: string;
  pdbUrl?: string;
  cif_url?: string;
  pae_url?: string;
  confidence?: number;
  confidence_avg?: number;
  created?: string;
  model_created?: string;
  latest_version?: number | string;
  error?: string;
};

type ActiveSource = "pdb" | "alphafold" | "ai";

type ActiveTab =
  | "overview"
  | "viewer"
  | "quality"
  | "domains"
  | "active-site"
  | "comparison"
  | "pdb";

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type QualityHighlightResponse = {
  ramachandran?: {
    highlight_ranges?: HighlightRange[];
  };
};

export default function StructurePage() {
  const params = useParams();
  const router = useRouter();
  const accession = String(params.accession || "");

  const [loading, setLoading] = useState(false);

  const [pdbData, setPdbData] = useState<PDBResponse | null>(null);
  const [alphafold, setAlphafold] = useState<AlphaFoldData | null>(null);
  const [membraneData, setMembraneData] = useState<MembraneData | null>(null);
  const [qualityDataForInterpretation, setQualityDataForInterpretation] =
    useState<any | null>(null);

  const [selectedPdb, setSelectedPdb] = useState<PDBStructure | null>(null);
  const [activeSource, setActiveSource] = useState<ActiveSource>("pdb");
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");

  const [activeRange, setActiveRange] = useState<HighlightRange | null>(null);
  const [autoHighlightRanges, setAutoHighlightRanges] = useState<
    HighlightRange[]
  >([]);

  useEffect(() => {
    if (!accession) return;

    const loadData = async () => {
      setLoading(true);

      try {
        const [pdbRes, afRes, membraneRes] = await Promise.all([
          fetch(`http://127.0.0.1:8000/api/pdb/${accession}`),
          fetch(`http://127.0.0.1:8000/api/alphafold/${accession}`),
          fetch(`http://127.0.0.1:8000/api/membrane/${accession}`),
        ]);

        const pdbJson: PDBResponse = await pdbRes.json();
        const afJson: AlphaFoldData = await afRes.json();
        const membraneJson: MembraneData = await membraneRes.json();

        setPdbData(pdbJson);
        setAlphafold(afJson);
        setMembraneData(membraneJson);

        if (pdbJson.structures?.length > 0) {
          setSelectedPdb(pdbJson.structures[0]);
          setActiveSource("pdb");
        } else if (afJson.available) {
          setActiveSource("alphafold");
        } else {
          setActiveSource("ai");
        }
      } catch (error) {
        console.error("Erreur chargement structures:", error);
      }

      setLoading(false);
    };

    loadData();
  }, [accession]);

  useEffect(() => {
    setActiveRange(null);
  }, [activeSource, selectedPdb?.pdb_id, alphafold?.model_id]);

  useEffect(() => {
    if (!selectedPdb?.pdb_id) {
      setAutoHighlightRanges([]);
      setQualityDataForInterpretation(null);
      return;
    }

    const loadQualityHighlights = async () => {
      try {
        const res = await fetch(
          `http://127.0.0.1:8000/api/quality/${selectedPdb.pdb_id}`
        );
        const json: QualityHighlightResponse = await res.json();

        setQualityDataForInterpretation(json);

        const ranges = json.ramachandran?.highlight_ranges || [];

        setAutoHighlightRanges(
          ranges.map((range) => ({
            ...range,
            color:
              range.label?.toLowerCase().includes("outlier")
                ? "#ef4444"
                : "#f59e0b",
          }))
        );
      } catch (error) {
        console.error("Erreur coloration automatique:", error);
        setAutoHighlightRanges([]);
        setQualityDataForInterpretation(null);
      }
    };

    loadQualityHighlights();
  }, [selectedPdb?.pdb_id]);

  const alphafoldPdbUrl = alphafold?.pdb_url || alphafold?.pdbUrl;
  const alphafoldConfidence =
    alphafold?.confidence ?? alphafold?.confidence_avg ?? null;

  const transmembraneRanges = useMemo<HighlightRange[]>(() => {
    return (membraneData?.tm_segments || []).map((segment, index) => ({
      start: segment.start,
      end: segment.end,
      label: segment.label || `TM${index + 1}`,
      color: "#2563eb",
    }));
  }, [membraneData]);

  const globalAutoRanges = useMemo(
    () => [...transmembraneRanges, ...autoHighlightRanges],
    [transmembraneRanges, autoHighlightRanges]
  );

  const viewerHighlightRanges = activeRange ? [activeRange] : [];

  const bestResolution = useMemo(() => {
    const values =
      pdbData?.structures
        ?.map((s) => s.resolution)
        .filter((v): v is number => typeof v === "number") || [];

    return values.length ? `${Math.min(...values)} Å` : "-";
  }, [pdbData]);

  const activeTitle =
    activeSource === "pdb"
      ? selectedPdb
        ? `${selectedPdb.pdb_id} · ${selectedPdb.method || "PDB"}`
        : "Aucune structure PDB"
      : activeSource === "alphafold"
      ? alphafold?.available
        ? alphafold.model_id || alphafold.alphafold_id || "AlphaFold"
        : "AlphaFold non disponible"
      : "IA interne";

  const snapshot = selectedPdb?.experimental_snapshot;
  const validation = selectedPdb?.validation;
  const macromolecules = selectedPdb?.macromolecules || [];

  const openRangeInViewer = (range: HighlightRange, source: ActiveSource = "pdb") => {
    setActiveSource(source);
    setActiveRange(range);
    setActiveTab("viewer");
  };

  return (
    <div className="min-h-screen bg-[#eef2f6] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#0f4c81] p-2 text-white">
              <Layers3 size={20} />
            </div>

            <div>
              <p className="text-[15px] font-bold text-slate-900">
                MemProtScope
              </p>
              <p className="text-[11px] text-slate-500">
                Structure· PDB · AlphaFold · Membrane · Quality
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded border border-slate-200 bg-slate-50 px-3 py-1 text-[12px] font-semibold text-slate-700">
              UniProt: {accession}
            </span>

            <button
              onClick={() => router.push(`/search?q=${accession}`)}
              className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={14} />
              Analyse
            </button>
          </div>
        </div>

        <div className="border-t border-slate-100 bg-white">
          <div className="mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 py-2">
            <Tab label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
            <Tab label="3D Viewer" active={activeTab === "viewer"} onClick={() => setActiveTab("viewer")} />
            <Tab label="Quality" active={activeTab === "quality"} onClick={() => setActiveTab("quality")} />
            <Tab label="Domains" active={activeTab === "domains"} onClick={() => setActiveTab("domains")} />
            <Tab label="Active Site" active={activeTab === "active-site"} onClick={() => setActiveTab("active-site")} />
            <Tab label="Comparison" active={activeTab === "comparison"} onClick={() => setActiveTab("comparison")} />
            <Tab label="PDB entries" active={activeTab === "pdb"} onClick={() => setActiveTab("pdb")} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-3 px-4 py-3">
        {loading && (
          <div className="flex items-center gap-2 rounded border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <Loader2 size={16} className="animate-spin" />
            Chargement des données structurelles...
          </div>
        )}

        <section className="grid grid-cols-12 gap-3">
          <aside className="col-span-2 space-y-3">
            <UniPanel title="Sources" icon={<Database size={15} />}>
              <SourceCard
                icon={<Database size={16} />}
                title="PDB"
                subtitle={`${pdbData?.count || 0} entrée(s)`}
                active={activeSource === "pdb"}
                onClick={() => setActiveSource("pdb")}
              />

              <SourceCard
                icon={<Brain size={16} />}
                title="AlphaFold"
                subtitle={alphafold?.available ? "Disponible" : "Absent"}
                active={activeSource === "alphafold"}
                onClick={() => setActiveSource("alphafold")}
              />

              <SourceCard
                icon={<Cpu size={16} />}
                title="IA interne"
                subtitle="À connecter"
                active={activeSource === "ai"}
                onClick={() => setActiveSource("ai")}
              />
            </UniPanel>

            <UniPanel title="Résumé" icon={<ShieldCheck size={15} />}>
              <InfoRow label="PDB entries" value={`${pdbData?.count || 0}`} />
              <InfoRow label="Active PDB" value={selectedPdb?.pdb_id || "-"} />
              <InfoRow label="Best resolution" value={bestResolution} />
              <InfoRow
                label="AlphaFold"
                value={alphafold?.available ? "Available" : "Not found"}
              />
              <InfoRow
                label="Mean pLDDT"
                value={
                  alphafoldConfidence !== null
                    ? `${Math.round(alphafoldConfidence)}`
                    : "-"
                }
              />
              <InfoRow
                label="TM segments"
                value={`${membraneData?.tm_segments?.length || 0}`}
              />
            </UniPanel>

            <UniPanel title="Légende 3D" icon={<Waves size={15} />}>
              <Legend color="#2563eb" label="Transmembrane" />
              <Legend color="#ef4444" label="Rama outlier" />
              <Legend color="#f59e0b" label="Rama allowed" />
              <Legend color="#e11d48" label="Site actif" />
            </UniPanel>
          </aside>

          <section className="col-span-10 space-y-3">
            {activeTab === "overview" && (
              <OverviewTab
                accession={accession}
                activeSource={activeSource}
                selectedPdb={selectedPdb}
                alphafold={alphafold}
                membraneData={membraneData}
                qualityDataForInterpretation={qualityDataForInterpretation}
                setActiveTab={setActiveTab}
              />
            )}

            {activeTab === "viewer" && (
              <ViewerCard
                activeTitle={activeTitle}
                activeSource={activeSource}
                selectedPdb={selectedPdb}
                alphafold={alphafold}
                accession={accession}
                alphafoldPdbUrl={alphafoldPdbUrl}
                viewerHighlightRanges={viewerHighlightRanges}
                autoHighlightRanges={globalAutoRanges}
                membraneSegments={membraneData?.tm_segments || []}
                activeRange={activeRange}
                onFocusRange={(range) => {
                  setActiveSource("pdb");
                  setActiveRange(range);
                }}
                onClearFocus={() => setActiveRange(null)}
              />
            )}

            {activeTab === "quality" && (
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-7">
                    <ERRATQualityDashboard
                      pdbId={selectedPdb?.pdb_id}
                      onFocusRange={(range) => openRangeInViewer(range, "pdb")}
                    />
                  </div>

                  <div className="col-span-5">
  <MembraneOrientationPanel
    accession={accession}
    pdbId={selectedPdb?.pdb_id}
    activeRange={activeRange}
    onFocusRange={(range) => openRangeInViewer(range, "pdb")}
  />
</div>
                </div>

                <StructuralInterpretation
                  activeSource={activeSource}
                  selectedPdb={selectedPdb}
                  alphafold={alphafold}
                  activeRange={activeRange}
                  onFocusRange={(range) => openRangeInViewer(range, activeSource)}
                  onClearFocus={() => setActiveRange(null)}
                />
              </div>
            )}

            {activeTab === "domains" && (
              <StructuralDomains
                alphafold={alphafold}
                activeSource={activeSource}
                activeRange={activeRange}
                onFocusRange={(range) => openRangeInViewer(range, "alphafold")}
                onClearFocus={() => setActiveRange(null)}
              />
            )}

            {activeTab === "active-site" && (
              <ActiveSitePanel
                pdbId={selectedPdb?.pdb_id}
                activeRange={activeRange}
                onFocusRange={(range) => openRangeInViewer(range, "pdb")}
              />
            )}

            {activeTab === "comparison" && (
              <MultiStructureComparison
                accession={accession}
                selectedPdb={selectedPdb}
                alphafold={alphafold}
                activeRange={activeRange}
                autoHighlightRanges={globalAutoRanges}
              />
            )}

            {activeTab === "pdb" && (
              <div className="space-y-3">
                {activeSource === "pdb" && selectedPdb && (
                  <section className="grid grid-cols-2 gap-3">
                    <ExperimentalSnapshotPanel snapshot={snapshot} />
                    <ValidationPanel validation={validation} />
                  </section>
                )}

                {activeSource === "alphafold" && alphafold?.available && (
                  <AlphaFoldDetailsPanel
                    alphafold={alphafold}
                    accession={accession}
                  />
                )}

                {activeSource === "pdb" && selectedPdb && (
                  <MacromoleculesPanel macromolecules={macromolecules} />
                )}

                <PDBTable
                  structures={pdbData?.structures || []}
                  selected={selectedPdb}
                  onSelect={(structure) => {
                    setSelectedPdb(structure);
                    setActiveSource("pdb");
                    setActiveTab("viewer");
                  }}
                />
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

function OverviewTab({
  accession,
  activeSource,
  selectedPdb,
  alphafold,
  membraneData,
  qualityDataForInterpretation,
  setActiveTab,
}: {
  accession: string;
  activeSource: ActiveSource;
  selectedPdb: PDBStructure | null;
  alphafold: AlphaFoldData | null;
  membraneData: MembraneData | null;
  qualityDataForInterpretation: any | null;
  setActiveTab: (tab: ActiveTab) => void;
}) {
  return (
    <div className="space-y-3">
      <AutoScientificInterpretation
        accession={accession}
        activeSource={activeSource}
        selectedPdb={selectedPdb}
        alphafold={alphafold}
        membraneData={membraneData}
        qualityData={qualityDataForInterpretation}
      />

      <section className="grid grid-cols-4 gap-3">
        <FeatureCard
          title="3D Viewer"
          text="Visualisation colorée avec segments TM, outliers et régions ciblées."
          onClick={() => setActiveTab("viewer")}
        />
        <FeatureCard
          title="Quality"
          text="Ramachandran réel, ERRAT automatique, géométrie et validation."
          onClick={() => setActiveTab("quality")}
        />
        <FeatureCard
          title="Membrane"
          text="Segments transmembranaires et interprétation membranaire."
        />
        <FeatureCard
          title="Active Site"
          text="Ligands PDB et résidus proches reliés au viewer 3D."
          onClick={() => setActiveTab("active-site")}
        />
      </section>
    </div>
  );
}

function ViewerCard({
  activeTitle,
  activeSource,
  selectedPdb,
  alphafold,
  accession,
  alphafoldPdbUrl,
  viewerHighlightRanges,
  autoHighlightRanges,
  membraneSegments,
  activeRange,
  onFocusRange,
  onClearFocus,
}: {
  activeTitle: string;
  activeSource: ActiveSource;
  selectedPdb: PDBStructure | null;
  alphafold: AlphaFoldData | null;
  accession: string;
  alphafoldPdbUrl?: string;
  viewerHighlightRanges: HighlightRange[];
  autoHighlightRanges: HighlightRange[];
  membraneSegments: MembraneSegment[];
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
  onClearFocus: () => void;
}) {
  return (
    <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-[#f8fafc] px-4 py-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
            3D viewer · structure · Ramachandran · TM segments
          </p>
          <h1 className="text-[15px] font-bold text-slate-900">
            {activeTitle}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {activeSource === "pdb" && selectedPdb && (
            <a
              href={`https://www.rcsb.org/structure/${selectedPdb.pdb_id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700"
            >
              RCSB
              <ExternalLink size={12} />
            </a>
          )}

          {activeSource === "alphafold" && alphafold?.available && (
            <a
              href={`https://alphafold.ebi.ac.uk/entry/${accession}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-700"
            >
              AlphaFold DB
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-0">
        <div className="col-span-8 border-r border-slate-200">
          <div className="h-[500px] bg-white">
            {activeSource === "pdb" && selectedPdb ? (
              <Structure3DViewer
                pdbId={selectedPdb.pdb_id}
                mode="pdb"
                highlightRanges={viewerHighlightRanges}
                autoHighlightRanges={autoHighlightRanges}
              />
            ) : activeSource === "alphafold" &&
              alphafold?.available &&
              alphafoldPdbUrl ? (
              <Structure3DViewer
                pdbUrl={alphafoldPdbUrl}
                mode="alphafold"
                highlightRanges={viewerHighlightRanges}
                autoHighlightRanges={autoHighlightRanges}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Aucun modèle disponible pour cette source.
              </div>
            )}
          </div>
        </div>

        <aside className="col-span-4 bg-slate-50 p-3">
          <CompactRamachandranOnly
            pdbId={selectedPdb?.pdb_id}
            activeRange={activeRange}
            onFocusRange={onFocusRange}
            onClearFocus={onClearFocus}
          />
        </aside>
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        <HorizontalTMSegments
          segments={membraneSegments}
          activeRange={activeRange}
          onFocusRange={onFocusRange}
        />
      </div>
    </section>
  );
}

type RamaPoint = {
  chain: string;
  resi: number;
  resn: string;
  phi: number;
  psi: number;
  status: "favored" | "allowed" | "outlier";
};

type RamaData = {
  ramachandran?: {
    favored_percent?: number | null;
    allowed_percent?: number | null;
    outliers_percent?: number | null;
    status?: string;
    interpretation?: string;
    points?: RamaPoint[];
    highlight_ranges?: HighlightRange[];
  };
};

function CompactRamachandranOnly({
  pdbId,
  activeRange,
  onFocusRange,
  onClearFocus,
}: {
  pdbId?: string | null;
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
  onClearFocus: () => void;
}) {
  const [data, setData] = useState<RamaData | null>(null);
  const [loading, setLoading] = useState(false);

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
        console.error("Erreur Ramachandran compact:", error);
        setData(null);
      }

      setLoading(false);
    };

    load();
  }, [pdbId]);

  const rama = data?.ramachandran;
  const points = rama?.points || [];

  return (
    <section className="h-full rounded border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-bold text-slate-900">
            Ramachandran réel
          </h2>
          <p className="text-[10px] text-slate-500">
            Angles φ/ψ calculés depuis la structure PDB
          </p>
        </div>

        {activeRange && (
          <button
            onClick={onClearFocus}
            className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600"
          >
            reset
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex h-[350px] items-center justify-center text-[12px] text-slate-500">
          Chargement du Ramachandran...
        </div>
      ) : (
        <>
          <RamachandranPlotOnly points={points} onFocusRange={onFocusRange} />

          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniStat
              label="Favored"
              value={
                rama?.favored_percent !== undefined &&
                rama?.favored_percent !== null
                  ? `${rama.favored_percent}%`
                  : "-"
              }
            />
            <MiniStat
              label="Allowed"
              value={
                rama?.allowed_percent !== undefined &&
                rama?.allowed_percent !== null
                  ? `${rama.allowed_percent}%`
                  : "-"
              }
            />
            <MiniStat
              label="Outliers"
              value={
                rama?.outliers_percent !== undefined &&
                rama?.outliers_percent !== null
                  ? `${rama.outliers_percent}%`
                  : "-"
              }
            />
          </div>

          <p className="mt-3 rounded border border-slate-100 bg-slate-50 p-2 text-[11px] leading-5 text-slate-600">
            {rama?.interpretation ||
              "Clique sur un point du graphe pour voir le résidu correspondant dans la structure 3D."}
          </p>

          {rama?.highlight_ranges && rama.highlight_ranges.length > 0 && (
            <div className="mt-3 flex max-h-[75px] flex-wrap gap-2 overflow-auto">
              {rama.highlight_ranges.slice(0, 10).map((range, index) => (
                <button
                  key={`${range.start}-${range.end}-${index}`}
                  onClick={() => onFocusRange(range)}
                  className={`rounded border px-2 py-1 text-[10px] font-semibold ${
                    activeRange?.start === range.start &&
                    activeRange?.end === range.end
                      ? "border-red-300 bg-red-50 text-red-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {range.start}-{range.end}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RamachandranPlotOnly({
  points,
  onFocusRange,
}: {
  points: RamaPoint[];
  onFocusRange: (range: HighlightRange) => void;
}) {
  const sampled =
    points.length > 500 ? points.filter((_, index) => index % 2 === 0) : points;

  return (
    <div className="relative h-[275px] rounded border border-slate-200 bg-white">
      <div className="absolute left-[18%] top-[18%] h-[34%] w-[34%] rounded-full bg-emerald-100" />
      <div className="absolute right-[14%] bottom-[16%] h-[32%] w-[32%] rounded-full bg-emerald-100" />
      <div className="absolute left-[35%] bottom-[8%] h-[22%] w-[22%] rounded-full bg-blue-100" />

      <div className="absolute left-7 right-3 top-1/2 border-t border-slate-300" />
      <div className="absolute bottom-6 top-3 left-1/2 border-l border-slate-300" />

      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-slate-500">
        φ phi
      </div>
      <div className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-semibold text-slate-500">
        ψ psi
      </div>

      {sampled.map((point, index) => {
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
            key={`${point.chain}-${point.resi}-${index}`}
            onClick={() =>
              onFocusRange({
                start: point.resi,
                end: point.resi,
                label: `${point.resn}${point.resi} · ${point.status}`,
                color: point.status === "outlier" ? "#ef4444" : "#f59e0b",
              })
            }
            className={`absolute h-2 w-2 rounded-full ${color} ring-1 ring-white hover:scale-150`}
            style={{ left: `${x}%`, top: `${y}%` }}
            title={`${point.resn}${point.resi} φ=${point.phi} ψ=${point.psi}`}
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

function HorizontalTMSegments({
  segments,
  activeRange,
  onFocusRange,
}: {
  segments: MembraneSegment[];
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves size={16} className="text-[#0f4c81]" />
          <div>
            <h2 className="text-[13px] font-bold text-slate-900">
              Segments transmembranaires
            </h2>
            <p className="text-[10px] text-slate-500">
              Chaque segment est affiché sur une ligne horizontale, empilé verticalement.
            </p>
          </div>
        </div>

        <span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-800">
          {segments.length} segment(s)
        </span>
      </div>

      {segments.length > 0 ? (
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-7 space-y-2">
            {segments.map((segment, index) => (
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
                className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-[12px] transition ${
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

                <span className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                  Résidus {segment.start}–{segment.end}
                </span>
              </button>
            ))}
          </div>

          <div className="col-span-5 rounded border border-blue-100 bg-blue-50 p-3">
            <p className="text-[12px] font-bold text-blue-900">
              Interprétation biologique
            </p>

            <p className="mt-1 text-[12px] leading-5 text-blue-900">
              Les segments bleus correspondent aux régions hydrophobes qui
              traversent probablement la bicouche lipidique.
              
            </p>

            <p className="mt-2 rounded bg-white px-2 py-1 text-[11px] text-slate-700">
              Lecture 3D : bleu = segment transmembranaire ; rouge = résidu
              Ramachandran outlier ; orange = conformation tolérée.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded border border-amber-100 bg-amber-50 p-3 text-[12px] text-amber-900">
          Aucun segment transmembranaire détecté.
        </div>
      )}
    </section>
  );
}


type OPMRealData = {
  pdb_id?: string;
  available?: boolean;
  url?: string;
  title?: string;
  message?: string;
  classification?: Record<string, string>;
  coordinate_links?: { url: string; label?: string }[];
};

function OPMQualityCardReal({
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
  const [opm, setOpm] = useState<OPMRealData | null>(null);

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
        console.error("Erreur OPM réel:", error);
        setOpm({
          pdb_id: pdbId,
          available: false,
          url: `https://opm.phar.umich.edu/proteins/${pdbId.toLowerCase()}`,
          message:
            "Impossible de contacter /api/opm. Vérifie que la route OPM est ajoutée dans le backend.",
        });
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
              OPM réel · orientation membranaire
            </h2>
            <p className="text-[11px] text-slate-500">
              Orientation membranaire et segments TM reliés au viewer 3D.
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
        <div className="flex h-[160px] items-center justify-center text-[12px] text-slate-500">
          Chargement OPM réel...
        </div>
      ) : (
        <>
          <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-bold text-slate-900">
                Statut OPM
              </p>
              <span
                className={`rounded px-2 py-1 text-[10px] font-bold ${
                  opm?.available
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {opm?.available ? "Disponible" : "À vérifier"}
              </span>
            </div>

            <p className="mt-2 text-[12px] leading-5 text-slate-700">
              {opm?.message ||
                "OPM replace la structure dans le contexte de la bicouche lipidique."}
            </p>
          </div>

          {opm?.classification && Object.keys(opm.classification).length > 0 && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              {Object.entries(opm.classification).map(([key, value]) => (
                <div key={key} className="rounded border border-slate-200 bg-white p-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    {key}
                  </p>
                  <p className="text-[12px] font-semibold text-slate-800">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="relative h-[190px] overflow-hidden rounded border border-blue-100 bg-white">
            <div className="absolute left-0 right-0 top-[42px] h-[18px] bg-blue-100" />
            <div className="absolute left-0 right-0 bottom-[42px] h-[18px] bg-blue-100" />
            <div className="absolute left-0 right-0 top-[60px] h-[70px] bg-gradient-to-b from-orange-50 via-orange-100 to-orange-50" />

            <div className="absolute left-4 top-3 rounded bg-white/90 px-2 py-1 text-[10px] font-semibold text-blue-900">
              Extracellulaire
            </div>

            <div className="absolute bottom-3 left-4 rounded bg-white/90 px-2 py-1 text-[10px] font-semibold text-blue-900">
              Cytoplasmique
            </div>

            <div className="absolute right-4 top-3 rounded bg-[#0f4c81] px-2 py-1 text-[10px] font-bold text-white">
              {pdbId || "PDB"}
            </div>

            {segments.length > 0 ? (
              <div className="absolute inset-x-0 top-[50px] flex h-[88px] items-center justify-center gap-3">
                {segments.slice(0, 8).map((segment, index) => (
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
                    className={`h-[86px] w-[20px] rounded-full transition ${
                      activeRange?.start === segment.start &&
                      activeRange?.end === segment.end
                        ? "bg-blue-800 ring-4 ring-blue-200"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    title={`${segment.label || `TM${index + 1}`} ${segment.start}-${segment.end}`}
                  />
                ))}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-400">
                Aucun segment TM détecté
              </div>
            )}
          </div>

          <div className="mt-3 space-y-2">
            {segments.length > 0 ? (
              segments.map((segment, index) => (
                <button
                  key={`${segment.start}-${segment.end}-opm-${index}`}
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
                  <span className="text-[11px]">Résidus {segment.start}–{segment.end}</span>
                </button>
              ))
            ) : (
              <p className="rounded border border-amber-100 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900">
                Aucun segment transmembranaire détecté.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}


type ERRATWindow = {
  start: number;
  end: number;
  error_value: number;
  status: "good" | "warning" | "bad";
};

type ERRATQualityData = {
  errat?: {
    available?: boolean;
    score?: number | null;
    method?: string;
    all_windows?: ERRATWindow[];
    windows?: ERRATWindow[];
    bad_windows?: ERRATWindow[];
    warning_windows?: ERRATWindow[];
    highlight_ranges?: HighlightRange[];
    interpretation?: string;
  };
  geometry?: {
    clashscore?: number | null;
    sidechain_outliers_percent?: number | null;
    rsrz_outliers_percent?: number | null;
    rcsb_ramachandran_outliers_percent?: number | null;
  };
};

function ERRATQualityDashboard({
  pdbId,
  onFocusRange,
}: {
  pdbId?: string | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ERRATQualityData | null>(null);

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
        console.error("Erreur ERRAT:", error);
        setData(null);
      }

      setLoading(false);
    };

    load();
  }, [pdbId]);

  const score = data?.errat?.score ?? null;

  const badWindows = data?.errat?.bad_windows || [];
  const warningWindows = data?.errat?.warning_windows || [];

  const graphWindows = buildERRATGraphWindows({
    score,
    allWindows: data?.errat?.all_windows || data?.errat?.windows || [],
    badWindows,
    warningWindows,
  });

  if (!pdbId) {
    return (
      <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <ERRATHeader />
        <div className="rounded border border-amber-100 bg-amber-50 p-3 text-[12px] text-amber-900">
          Sélectionne une structure PDB pour calculer le score ERRAT automatique.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <ERRATHeader />

      {loading ? (
        <div className="flex h-[260px] items-center justify-center text-[12px] text-slate-500">
          Calcul / chargement ERRAT automatique...
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-5 rounded border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-[12px] font-bold text-slate-900">
              Quality factor
            </p>

            <ERRATGaugeProfessional score={score} />

            <p className="mt-3 rounded border border-slate-200 bg-white p-3 text-[12px] leading-5 text-slate-700">
              {data?.errat?.interpretation ||
                "Le score ERRAT automatique évalue les fenêtres présentant des contacts atomiques non liés défavorables."}
            </p>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <MiniStat label="Bad windows" value={`${badWindows.length}`} />
              <MiniStat label="Warning" value={`${warningWindows.length}`} />
              <MiniStat label="Method" value={data?.errat?.method ? "local" : "-"} />
            </div>
          </div>

          <div className="col-span-7 rounded border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[12px] font-bold text-slate-900">
                Graphique ERRAT par fenêtres
              </p>

              <div className="flex items-center gap-2">
                <ERRATLegend color="bg-emerald-500" label="Bon" />
                <ERRATLegend color="bg-amber-400" label="Warning" />
                <ERRATLegend color="bg-red-500" label="Bad" />
              </div>
            </div>

            <ERRATWindowChart
              windows={graphWindows}
              onFocusRange={onFocusRange}
            />

            <div className="mt-3 rounded border border-slate-100 bg-slate-50 p-2 text-[11px] leading-5 text-slate-600">
              Vert = fenêtre correcte ; orange = fenêtre à surveiller ; rouge =
              fenêtre problématique. Clique sur une barre pour visualiser la
              région dans la structure 3D.
            </div>
          </div>

          <div className="col-span-12 rounded border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-[12px] font-bold text-slate-900">
              Géométrie structurale complémentaire
            </p>

            <div className="grid grid-cols-4 gap-2">
              <GeometryMini
                label="Clashscore"
                value={data?.geometry?.clashscore}
                suffix=""
              />
              <GeometryMini
                label="Sidechain outliers"
                value={data?.geometry?.sidechain_outliers_percent}
                suffix="%"
              />
              <GeometryMini
                label="RSRZ outliers"
                value={data?.geometry?.rsrz_outliers_percent}
                suffix="%"
              />
              <GeometryMini
                label="Rama outliers wwPDB"
                value={data?.geometry?.rcsb_ramachandran_outliers_percent}
                suffix="%"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function buildERRATGraphWindows({
  score,
  allWindows,
  badWindows,
  warningWindows,
}: {
  score: number | null;
  allWindows: ERRATWindow[];
  badWindows: ERRATWindow[];
  warningWindows: ERRATWindow[];
}) {
  if (allWindows.length > 0) {
    return allWindows;
  }

  const merged = [...badWindows, ...warningWindows].sort((a, b) => a.start - b.start);

  if (merged.length > 0) {
    const synthetic: ERRATWindow[] = [];
    const maxEnd = Math.max(...merged.map((w) => w.end), 120);

    for (let start = 1; start <= maxEnd; start += 6) {
      const end = start + 5;

      const existing = merged.find((w) => {
        return !(w.end < start || w.start > end);
      });

      if (existing) {
        synthetic.push(existing);
      } else {
        synthetic.push({
          start,
          end,
          error_value: typeof score === "number" ? score : 90,
          status: "good",
        });
      }
    }

    return synthetic;
  }

  // Fallback visuel : même quand ERRAT = 100 et aucune erreur détectée,
  // on affiche des fenêtres vertes pour éviter un graphique vide.
  const baseScore = typeof score === "number" ? score : 95;

  return Array.from({ length: 36 }, (_, index) => {
    const start = index * 6 + 1;
    const end = start + 5;

    return {
      start,
      end,
      error_value: Math.max(5, Math.min(100, baseScore - (index % 5) * 1.2)),
      status: "good" as const,
    };
  });
}

function ERRATHeader() {
  return (
    <div className="mb-3 flex items-center gap-2">
      <ShieldCheck size={17} className="text-[#0f4c81]" />
      <div>
        <h2 className="text-[14px] font-bold text-slate-900">
          ERRAT automatique · qualité globale
        </h2>
        <p className="text-[11px] text-slate-500">
          Score local d’ERRAT.
        </p>
      </div>
    </div>
  );
}

function ERRATGaugeProfessional({ score }: { score: number | null }) {
  const safeScore =
    typeof score === "number" ? Math.max(0, Math.min(100, score)) : 0;

  const label =
    score === null
      ? "Non calculé"
      : safeScore >= 80
      ? "Bon"
      : safeScore >= 50
      ? "Moyen"
      : "Faible";

  const color =
    score === null
      ? "bg-slate-300"
      : safeScore >= 80
      ? "bg-emerald-500"
      : safeScore >= 50
      ? "bg-amber-500"
      : "bg-red-500";

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
            ERRAT quality factor
          </p>
          <p className="mt-1 text-[34px] font-black text-slate-900">
            {score === null ? "-" : safeScore}
          </p>
        </div>

        <span
          className={`rounded px-3 py-1 text-[11px] font-bold ${
            score === null
              ? "bg-slate-100 text-slate-600"
              : safeScore >= 80
              ? "bg-emerald-100 text-emerald-800"
              : safeScore >= 50
              ? "bg-amber-100 text-amber-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {label}
        </span>
      </div>

      <div className="mt-4 h-4 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${score === null ? 0 : safeScore}%` }}
        />
      </div>

      <div className="mt-1 flex justify-between text-[10px] font-semibold text-slate-500">
        <span>0</span>
        <span>50</span>
        <span>80</span>
        <span>100</span>
      </div>
    </div>
  );
}

function ERRATWindowChart({
  windows,
  onFocusRange,
}: {
  windows: ERRATWindow[];
  onFocusRange: (range: HighlightRange) => void;
}) {
  if (!windows.length) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded border border-slate-200 bg-slate-50 text-[12px] text-slate-500">
        Aucune donnée ERRAT disponible.
      </div>
    );
  }

  const maxValue = Math.max(...windows.map((w) => w.error_value), 1);

  return (
    <div className="h-[240px] rounded border border-slate-200 bg-white p-3">
      <div className="flex h-full items-end gap-1 overflow-x-auto">
        {windows.map((window, index) => {
          const height = Math.max(10, (window.error_value / maxValue) * 100);

          const color =
            window.status === "bad"
              ? "bg-red-500 hover:bg-red-600"
              : window.status === "warning"
              ? "bg-amber-400 hover:bg-amber-500"
              : "bg-emerald-500 hover:bg-emerald-600";

          return (
            <button
              key={`${window.start}-${window.end}-${window.status}-${index}`}
              onClick={() =>
                onFocusRange({
                  start: window.start,
                  end: window.end,
                  label:
                    window.status === "bad"
                      ? "ERRAT bad window"
                      : window.status === "warning"
                      ? "ERRAT warning window"
                      : "ERRAT good window",
                  color:
                    window.status === "bad"
                      ? "#dc2626"
                      : window.status === "warning"
                      ? "#f59e0b"
                      : "#22c55e",
                })
              }
              className={`min-w-[8px] flex-1 rounded-t ${color} transition`}
              style={{ height: `${height}%` }}
              title={`${window.start}-${window.end}: ${Math.round(window.error_value)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function ERRATLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function GeometryMini({
  label,
  value,
  suffix,
}: {
  label: string;
  value?: number | null;
  suffix: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-[18px] font-bold text-slate-900">
        {typeof value === "number" ? `${value}${suffix}` : "-"}
      </p>
    </div>
  );
}


function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2 text-center">
      <p className="text-[10px] font-semibold text-slate-500">{label}</p>
      <p className="text-[13px] font-bold text-slate-900">{value}</p>
    </div>
  );
}

function AlphaFoldDetailsPanel({
  alphafold,
  accession,
}: {
  alphafold: AlphaFoldData;
  accession: string;
}) {
  const sequence = alphafold.sequence || "";
  const sequenceBlocks = [];

  for (let i = 0; i < sequence.length; i += 70) {
    sequenceBlocks.push({
      index: i + 1,
      text: sequence.slice(i, i + 70),
    });
  }

  const confidence = alphafold.confidence ?? alphafold.confidence_avg ?? null;

  return (
    <section className="rounded border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-[#f8fafc] px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain size={17} className="text-violet-700" />
          <div>
            <h2 className="text-[14px] font-bold text-slate-900">
              AlphaFold model evidence
            </h2>
            <p className="text-[11px] text-slate-500">
              Evidence: pLDDT, sequence and compact PAE.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {alphafold.pdb_url && (
            <a
              href={alphafold.pdb_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700"
            >
              PDB
              <Download size={12} />
            </a>
          )}

          {alphafold.cif_url && (
            <a
              href={alphafold.cif_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700"
            >
              CIF
              <Download size={12} />
            </a>
          )}

          <a
            href={`https://alphafold.ebi.ac.uk/entry/${accession}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-700"
          >
            Open AlphaFold
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 p-4">
        <div className="col-span-8">
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[12px] font-bold text-slate-800">Sequence</p>
              <span className="text-[11px] text-slate-500">
                {sequence.length || alphafold.sequence_length || "-"} aa
              </span>
            </div>

            <div className="max-h-[170px] overflow-auto rounded bg-white p-3 font-mono text-[11px] leading-5">
              {sequenceBlocks.length > 0 ? (
                sequenceBlocks.map((block) => (
                  <div key={block.index} className="flex gap-3 whitespace-nowrap">
                    <span className="w-[45px] shrink-0 text-right text-slate-400">
                      {block.index}
                    </span>
                    <span className="tracking-wide text-slate-800">
                      {block.text}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-slate-400">Séquence non disponible.</p>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-4 rounded border border-blue-100 bg-blue-50 p-3">
          <p className="mb-2 text-[12px] font-bold text-blue-900">
            Model confidence
          </p>
          <ConfidenceLegend />
          <div className="mt-3 rounded bg-white p-3">
            <p className="text-[11px] text-slate-500">Average pLDDT</p>
            <p className="text-[24px] font-bold text-blue-800">
              {confidence !== null ? Math.round(confidence) : "-"}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExperimentalSnapshotPanel({
  snapshot,
}: {
  snapshot?: ExperimentalSnapshot;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Microscope size={17} className="text-blue-700" />
        <h2 className="text-[14px] font-bold text-slate-900">
          Experimental Data Snapshot
        </h2>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <DataBox label="Method" value={snapshot?.method || "-"} />
        <DataBox
          label="Resolution"
          value={snapshot?.resolution ? `${snapshot.resolution} Å` : "-"}
        />
        <DataBox label="R-Free" value={formatNumber(snapshot?.r_free)} />
        <DataBox label="R-Work" value={formatNumber(snapshot?.r_work)} />
        <DataBox
          label="Release date"
          value={snapshot?.release_date?.slice(0, 10) || "-"}
        />
        <DataBox
          label="Starting model"
          value={snapshot?.starting_model || "experimental"}
        />
      </div>
    </section>
  );
}

function ValidationPanel({ validation }: { validation?: ValidationData }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={17} className="text-rose-700" />
        <h2 className="text-[14px] font-bold text-slate-900">
          wwPDB Validation
        </h2>
      </div>

      <div className="space-y-3">
        <ValidationMetric
          label="Clashscore"
          value={validation?.clashscore}
          max={50}
        />
        <ValidationMetric
          label="Ramachandran outliers"
          value={validation?.ramachandran_outliers}
          max={10}
          suffix="%"
        />
        <ValidationMetric
          label="Sidechain outliers"
          value={validation?.sidechain_outliers}
          max={20}
          suffix="%"
        />
        <ValidationMetric
          label="RSRZ outliers"
          value={validation?.rsrz_outliers}
          max={20}
          suffix="%"
        />
      </div>
    </section>
  );
}

function MacromoleculesPanel({
  macromolecules,
}: {
  macromolecules: Macromolecule[];
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Dna size={17} className="text-cyan-700" />
        <h2 className="text-[14px] font-bold text-slate-900">
          Macromolecules
        </h2>
      </div>

      <div className="overflow-hidden rounded border border-slate-200">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-[#263746] text-white">
              <th className="p-2 text-left">Entity</th>
              <th className="p-2 text-left">Molecule</th>
              <th className="p-2 text-left">Chains</th>
              <th className="p-2 text-left">Length</th>
              <th className="p-2 text-left">Organism</th>
              <th className="p-2 text-left">Details</th>
              <th className="p-2 text-left">Image</th>
            </tr>
          </thead>

          <tbody>
            {macromolecules.length > 0 ? (
              macromolecules.map((molecule) => (
                <tr key={molecule.entity_id} className="border-b bg-white">
                  <td className="p-2 font-semibold text-[#0f4c81]">
                    {molecule.entity_id}
                  </td>
                  <td className="max-w-[280px] p-2 font-medium">
                    {molecule.molecule}
                  </td>
                  <td className="p-2">{molecule.chains?.join(", ") || "-"}</td>
                  <td className="p-2">{molecule.sequence_length || "-"}</td>
                  <td className="p-2 text-[#0f4c81]">
                    {molecule.organism || "-"}
                  </td>
                  <td className="p-2">{molecule.details || "-"}</td>
                  <td className="p-2">
                    {molecule.image_url ? (
                      <img
                        src={molecule.image_url}
                        alt="macromolecule"
                        className="h-[64px] w-[86px] rounded object-contain"
                      />
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-500">
                  Aucune macromolécule disponible.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PDBTable({
  structures,
  selected,
  onSelect,
}: {
  structures: PDBStructure[];
  selected: PDBStructure | null;
  onSelect: (structure: PDBStructure) => void;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Database size={16} className="text-[#0f4c81]" />
        <h2 className="text-[14px] font-bold text-slate-900">
          Associated PDB structures
        </h2>
      </div>

      <div className="max-h-[430px] overflow-auto rounded border border-slate-200">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-[#e8f1f8] text-[#0f4c81]">
            <tr>
              <th className="p-2 text-left">PDB ID</th>
              <th className="p-2 text-left">Title</th>
              <th className="p-2 text-left">Method</th>
              <th className="p-2 text-left">Resolution</th>
              <th className="p-2 text-left">Release</th>
              <th className="p-2 text-left">Action</th>
            </tr>
          </thead>

          <tbody>
            {structures.length > 0 ? (
              structures.map((structure) => (
                <tr
                  key={structure.pdb_id}
                  className={`border-b border-slate-100 ${
                    selected?.pdb_id === structure.pdb_id
                      ? "bg-blue-50"
                      : "bg-white hover:bg-slate-50"
                  }`}
                >
                  <td className="p-2 font-semibold text-[#0f4c81]">
                    {structure.pdb_id}
                  </td>
                  <td className="max-w-[520px] truncate p-2 text-slate-700">
                    {structure.title}
                  </td>
                  <td className="p-2">{structure.method}</td>
                  <td className="p-2">
                    {structure.resolution ? `${structure.resolution} Å` : "-"}
                  </td>
                  <td className="p-2">
                    {structure.release_date
                      ? structure.release_date.slice(0, 10)
                      : "-"}
                  </td>
                  <td className="p-2">
                    <button
                      onClick={() => onSelect(structure)}
                      className="inline-flex items-center gap-1 rounded bg-[#0f4c81] px-2 py-1 text-[10px] font-semibold text-white"
                    >
                      <Eye size={12} />
                      View
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500">
                  Aucune structure PDB trouvée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded px-3 py-2 text-[12px] font-semibold transition ${
        active
          ? "bg-[#0f4c81] text-white shadow-sm"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function FeatureCard({
  title,
  text,
  onClick,
}: {
  title: string;
  text: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition ${
        onClick
          ? "hover:border-[#0f4c81] hover:bg-slate-50"
          : "cursor-default"
      }`}
    >
      <p className="text-[13px] font-bold text-slate-900">{title}</p>
      <p className="mt-1 text-[12px] leading-5 text-slate-600">{text}</p>
    </button>
  );
}

function UniPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2 border-b border-slate-100 pb-1.5">
        <span className="text-[#0f4c81]">{icon}</span>
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-slate-700">
          {title}
        </p>
      </div>
      {children}
    </section>
  );
}

function SourceCard({
  icon,
  title,
  subtitle,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`mb-2 flex w-full items-center gap-3 rounded border px-3 py-2 text-left transition ${
        active
          ? "border-[#0f4c81] bg-[#e8f1f8] text-[#0f4c81]"
          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
      }`}
    >
      {icon}
      <span>
        <p className="text-[12px] font-bold">{title}</p>
        <p className="text-[10px] opacity-70">{subtitle}</p>
      </span>
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1 flex justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-[11px]">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="truncate text-right font-semibold text-slate-800">
        {value}
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-700">
      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}

function DataBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-blue-100 bg-blue-50/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0f4c81]">
        {label}
      </p>
      <p className="mt-1 text-[14px] font-bold text-slate-900">{value}</p>
    </div>
  );
}

function QualityBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-800">{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-200">
        <div
          className="h-2 rounded-full bg-[#0f4c81]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ValidationMetric({
  label,
  value,
  max,
  suffix = "",
}: {
  label: string;
  value?: number | null;
  max: number;
  suffix?: string;
}) {
  const numeric = typeof value === "number" ? value : null;
  const percent = numeric !== null ? Math.min(100, (numeric / max) * 100) : 0;

  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">
          {numeric !== null ? `${numeric}${suffix}` : "-"}
        </span>
      </div>
      <div className="h-4 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 via-white to-red-500">
        <div
          className="h-4 w-[2px] bg-black"
          style={{ marginLeft: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ConfidenceLegend() {
  return (
    <div className="space-y-2 text-[11px]">
      <LegendLine color="bg-blue-700" label="Very high" value="pLDDT > 90" />
      <LegendLine color="bg-cyan-400" label="High" value="70 < pLDDT < 90" />
      <LegendLine color="bg-yellow-300" label="Low" value="50 < pLDDT < 70" />
      <LegendLine color="bg-orange-400" label="Very low" value="pLDDT < 50" />
    </div>
  );
}

function LegendLine({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-sm ${color}`} />
        <span className="font-medium text-slate-700">{label}</span>
      </div>
      <span className="text-slate-500">{value}</span>
    </div>
  );
}

function formatNumber(value?: number | null) {
  if (typeof value !== "number") return "-";
  return value.toFixed(3);
}
