"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Info,
  XCircle,
  Boxes,
  Brain,
  ChevronRight,
  Crosshair,
  Database,
  Dna,
  Download,
  ExternalLink,
  GitBranch,
  GitCompare,
  Layers,
  LayoutDashboard,
  Loader2,
  ShieldCheck,
  Waves,
} from "lucide-react";

import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { Alert, StatCard } from "@/components/ui";
import StructuralDomains from "@/components/StructuralDomains";
import AutoScientificInterpretation from "@/components/AutoScientificInterpretation";
import ActiveSitePanel from "@/components/ActiveSitePanel";
import MultiStructureComparison from "@/components/MultiStructureComparison";
import MembraneOrientationPanel from "@/components/MembraneOrientationPanel";
import { API_BASE } from "@/lib/api";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";
import PlddtProfile from "@/components/protein/PlddtProfile";
import SaveToProject from "@/components/SaveToProject";
import EvolutionPanel from "@/components/evolution/EvolutionPanel";
import PredictedStructurePanel from "@/components/prediction/PredictedStructurePanel";
import ComparisonPanel from "@/components/prediction/ComparisonPanel";
import { mapRanges, type NumberedRange, type ResidueMapping } from "@/lib/mapping";

const Structure3DViewer = dynamic(() => import("@/components/Structure3DViewer"), {
  ssr: false,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExperimentalSnapshot = {
  method?: string;
  resolution?: number | null;
  r_free?: number | null;
  r_work?: number | null;
  release_date?: string;
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
  is_target?: boolean;
};

type PDBStructure = {
  pdb_id: string;
  title: string;
  method: string;
  resolution: number | null;
  release_date: string;
  chains?: string[];
  coverage_percent?: number | null;
  coverage_ranges?: { start: number; end: number }[];
  experimental_snapshot?: ExperimentalSnapshot;
  validation?: ValidationData;
  macromolecules?: Macromolecule[];
};

type PDBResponse = {
  accession?: string;
  count: number;
  total_count?: number;
  uniprot_length?: number;
  structures: PDBStructure[];
  error?: string;
};

type MembraneSegment = { start: number; end: number; label?: string };

type MembraneData = {
  method?: string;
  is_membrane?: boolean | null;
  predicted_type?: string | null;
  tm_segments?: MembraneSegment[];
  error?: string;
};

type AlphaFoldData = {
  accession?: string;
  available: boolean;
  model_id?: string;
  protein_name?: string;
  organism?: string;
  gene?: string;
  sequence?: string;
  sequence_length?: number;
  pdb_url?: string;
  cif_url?: string;
  pae_image_url?: string;
  plddt_url?: string;
  confidence?: number | null;
  plddt_fractions?: {
    very_high?: number | null;
    confident?: number | null;
    low?: number | null;
    very_low?: number | null;
  };
  tool?: string;
  model_created?: string;
  latest_version?: number | string;
  error?: string;
};

type UniProtData = {
  accession: string;
  available?: boolean;
  protein_name?: string;
  organism?: string;
  gene_names?: string[];
  length?: number;
};

type RamaPoint = {
  chain: string;
  resi: number;
  resn: string;
  phi: number;
  psi: number;
  status: "favored" | "allowed" | "outlier";
};

type ContactWindow = {
  chain?: string;
  start: number;
  end: number;
  error_value: number;
  status: "good" | "warning" | "bad";
};

type QualityData = {
  pdb_id?: string;
  error?: string;
  ramachandran?: {
    favored_percent?: number | null;
    allowed_percent?: number | null;
    outliers_percent?: number | null;
    status?: string;
    interpretation?: string;
    points?: RamaPoint[];
    highlight_ranges?: HighlightRange[];
  };
  geometry?: {
    available?: boolean;
    clashscore?: number | null;
    sidechain_outliers_percent?: number | null;
    rsrz_outliers_percent?: number | null;
    rcsb_ramachandran_outliers_percent?: number | null;
  };
  errat?: {
    available?: boolean;
    score?: number | null;
    method?: string;
    all_windows?: ContactWindow[];
    bad_windows?: ContactWindow[];
    warning_windows?: ContactWindow[];
    interpretation?: string;
  };
};

type HighlightRange = NumberedRange;

type Source = "pdb" | "alphafold";

type TabKey =
  | "overview"
  | "quality"
  | "membrane"
  | "domains"
  | "active-site"
  | "comparison"
  | "evolution"
  | "prediction"
  | "entries";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Vue d’ensemble", icon: <LayoutDashboard size={14} /> },
  { key: "quality", label: "Qualité", icon: <ShieldCheck size={14} /> },
  { key: "membrane", label: "Membrane", icon: <Waves size={14} /> },
  { key: "domains", label: "Domaines", icon: <Dna size={14} /> },
  { key: "active-site", label: "Site actif", icon: <Crosshair size={14} /> },
  { key: "comparison", label: "PDB / AlphaFold", icon: <GitCompare size={14} /> },
  { key: "evolution", label: "Évolution", icon: <GitBranch size={14} /> },
  { key: "prediction", label: "Structure prédite", icon: <Brain size={14} /> },
  { key: "entries", label: "Entrées PDB", icon: <Database size={14} /> },
];

// Couleurs officielles AlphaFold DB pour le pLDDT
const PLDDT_BANDS = [
  { key: "very_high", label: "Très élevé (> 90)", color: "#0053d6" },
  { key: "confident", label: "Confiant (70–90)", color: "#65cbf3" },
  { key: "low", label: "Faible (50–70)", color: "#ffdb13" },
  { key: "very_low", label: "Très faible (< 50)", color: "#ff7d45" },
] as const;

const RAMA_COLORS = { favored: "#16a34a", allowed: "#d97706", outlier: "#dc2626" } as const;
const RAMA_LABELS = { favored: "Favorable", allowed: "Autorisé", outlier: "Hors régions" } as const;

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null
    ? "—"
    : `${value.toLocaleString("fr-FR", { maximumFractionDigits: digits })}${suffix}`;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StructurePage() {
  const params = useParams();
  const accession = String(params.accession || "").toUpperCase();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uniprot, setUniprot] = useState<UniProtData | null>(null);
  const [pdbData, setPdbData] = useState<PDBResponse | null>(null);
  const [alphafold, setAlphafold] = useState<AlphaFoldData | null>(null);
  const [membraneData, setMembraneData] = useState<MembraneData | null>(null);
  const [quality, setQuality] = useState<QualityData | null>(null);
  const [loadingQuality, setLoadingQuality] = useState(false);
  const [mapping, setMapping] = useState<ResidueMapping | null>(null);

  const [selectedPdb, setSelectedPdb] = useState<PDBStructure | null>(null);
  const [source, setSource] = useState<Source>("pdb");
  const [tab, setTab] = useState<TabKey>("overview");

  // Onglet demandé dans l'adresse (?tab=evolution…)
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted && TABS.some((t) => t.key === wanted)) setTab(wanted as TabKey);
  }, []);
  const [activeRange, setActiveRange] = useState<HighlightRange | null>(null);

  useEffect(() => {
    if (!accession) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const getJson = (path: string) => fetch(`${API_BASE}${path}`).then((r) => r.json());

    Promise.allSettled([
      getJson(`/api/uniprot/${accession}`),
      getJson(`/api/pdb/${accession}`),
      getJson(`/api/alphafold/${accession}`),
      getJson(`/api/membrane/${accession}`),
    ]).then(([uni, pdb, af, mem]) => {
      if (cancelled) return;
      if ([uni, pdb, af, mem].every((r) => r.status === "rejected")) {
        setLoadError("Impossible de joindre le serveur d’analyse.");
      }
      if (uni.status === "fulfilled") setUniprot(uni.value);
      const pdbJson: PDBResponse | null = pdb.status === "fulfilled" ? pdb.value : null;
      const afJson: AlphaFoldData | null = af.status === "fulfilled" ? af.value : null;
      setPdbData(pdbJson);
      setAlphafold(afJson);
      if (mem.status === "fulfilled") setMembraneData(mem.value);

      if (pdbJson?.structures?.length) {
        // Structure demandée dans l'adresse (?pdb=), sinon la mieux classée
        const wanted = new URLSearchParams(window.location.search).get("pdb")?.toUpperCase();
        setSelectedPdb(pdbJson.structures.find((s) => s.pdb_id === wanted) ?? pdbJson.structures[0]);
        setSource("pdb");
      } else if (afJson?.available) {
        setSource("alphafold");
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [accession]);

  // Une seule requête qualité par structure, partagée par tous les onglets
  useEffect(() => {
    setQuality(null);
    if (!selectedPdb?.pdb_id) return;
    let cancelled = false;
    setLoadingQuality(true);
    fetch(`${API_BASE}/api/quality/${selectedPdb.pdb_id}`)
      .then((r) => r.json())
      .then((json) => !cancelled && setQuality(json))
      .catch(() => !cancelled && setQuality(null))
      .finally(() => !cancelled && setLoadingQuality(false));
    return () => {
      cancelled = true;
    };
  }, [selectedPdb?.pdb_id]);

  // Correspondance de numérotation UniProt → structure sélectionnée (SIFTS)
  useEffect(() => {
    setMapping(null);
    if (!selectedPdb?.pdb_id || !accession) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/mapping/${selectedPdb.pdb_id}/${accession}`)
      .then((r) => r.json())
      .then((json) => !cancelled && setMapping(json))
      .catch(() => !cancelled && setMapping(null));
    return () => {
      cancelled = true;
    };
  }, [selectedPdb?.pdb_id, accession]);

  useEffect(() => {
    setActiveRange(null);
  }, [source, selectedPdb?.pdb_id]);

  const structures = useMemo(() => pdbData?.structures ?? [], [pdbData]);
  const tmSegments = useMemo(() => membraneData?.tm_segments ?? [], [membraneData]);
  const proteinLength = uniprot?.length || pdbData?.uniprot_length || alphafold?.sequence_length || 0;
  const proteinName = uniprot?.protein_name || alphafold?.protein_name || accession;
  const organism = uniprot?.organism || alphafold?.organism;
  const gene = uniprot?.gene_names?.[0] || alphafold?.gene;

  const bestResolution = useMemo(() => {
    const values = structures
      .map((s) => s.resolution)
      .filter((v): v is number => typeof v === "number");
    return values.length ? Math.min(...values) : null;
  }, [structures]);

  const tmRanges = useMemo<HighlightRange[]>(
    () =>
      tmSegments.map((s, i) => ({
        start: s.start,
        end: s.end,
        label: s.label || `TM${i + 1}`,
        color: "#d97706",
      })),
    [tmSegments]
  );

  const qualityRanges = useMemo<HighlightRange[]>(
    () =>
      (quality?.ramachandran?.highlight_ranges ?? [])
        .filter((r) => r.label?.toLowerCase().includes("outlier"))
        .map((r) => ({ ...r, color: RAMA_COLORS.outlier, numbering: "pdb" as const })),
    [quality]
  );

  const focus = (range: HighlightRange, target?: Source) => {
    if (target) setSource(target);
    setActiveRange(range);
  };

  const selectStructure = (structure: PDBStructure) => {
    setSelectedPdb(structure);
    setSource("pdb");
  };

  // Vue 3D placée à côté du contenu des onglets Domaines, Site actif et Qualité
  const withViewer = (content: React.ReactNode, viewerSource: Source) => (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0">{content}</div>
      <div className="xl:sticky xl:top-4">
        <FocusViewer
          source={viewerSource}
          selectedPdb={selectedPdb}
          alphafold={alphafold}
          mapping={mapping}
          tmRanges={tmRanges}
          extraRanges={viewerSource === "pdb" ? qualityRanges : []}
          activeRange={activeRange}
          setActiveRange={setActiveRange}
        />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader />

      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative w-full px-4 py-5 lg:px-6">
          <nav className="flex flex-wrap items-center gap-1 text-[13px] text-blue-200">
            <Link href="/" className="hover:text-white">
              Accueil
            </Link>
            <ChevronRight size={12} />
            <Link href={`/search?q=${accession}`} className="hover:text-white">
              Analyse de séquence
            </Link>
            <ChevronRight size={12} />
            <span className="text-white">Structures</span>
            <ChevronRight size={12} />
            <span className="font-mono text-cyan-200">{accession}</span>
          </nav>

          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-white/15 px-2 py-0.5 font-mono text-[14px] font-semibold text-white">
                  {accession}
                </span>
                {gene && (
                  <span className="rounded bg-cyan-400/20 px-2 py-0.5 font-mono text-[13px] font-semibold text-cyan-100">
                    {gene}
                  </span>
                )}
              </div>
              <h1 className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">
                {proteinName}
              </h1>
              {organism && <p className="text-[15px] italic text-blue-100">{organism}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <SaveToProject
                variant="dark"
                kind="structure"
                title={`${proteinName}${source === "pdb" && selectedPdb ? ` · ${selectedPdb.pdb_id}` : " · AlphaFold"}`}
                payload={{
                  accession,
                  protein_name: proteinName,
                  pdb_id: source === "pdb" ? selectedPdb?.pdb_id : undefined,
                  source,
                  length: proteinLength || undefined,
                }}
              />
              <Link
                href={`/search?q=${accession}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] font-medium text-white hover:bg-white/20"
              >
                <ArrowLeft size={14} />
                Analyse de séquence
              </Link>
              <a
                href={`https://www.uniprot.org/uniprotkb/${accession}/entry`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] font-medium text-white hover:bg-white/20"
              >
                UniProt
                <ExternalLink size={13} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <div className="sticky top-[var(--site-header-h,62px)] z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex w-full flex-col gap-2 px-4 py-2 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div role="tablist" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[14px] font-semibold transition ${
                  tab === t.key
                    ? "bg-[#0f4c81] text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md bg-slate-100 p-0.5" role="radiogroup" aria-label="Source du modèle">
              {(
                [
                  ["pdb", "PDB", structures.length > 0],
                  ["alphafold", "AlphaFold", !!alphafold?.available],
                ] as const
              ).map(([key, label, enabled]) => (
                <button
                  key={key}
                  role="radio"
                  aria-checked={source === key}
                  disabled={!enabled}
                  onClick={() => setSource(key)}
                  className={`rounded px-2.5 py-1 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    source === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {structures.length > 0 && (
              <select
                aria-label="Structure PDB"
                value={selectedPdb?.pdb_id ?? ""}
                onChange={(e) => {
                  const s = structures.find((x) => x.pdb_id === e.target.value);
                  if (s) selectStructure(s);
                }}
                className="max-w-[320px] rounded-md border border-slate-300 bg-white px-2 py-1 text-[14px] text-slate-800"
              >
                {structures.map((s) => (
                  <option key={s.pdb_id} value={s.pdb_id}>
                    {s.pdb_id} · {shortMethod(s.method)} · {fmt(s.resolution, 2, " Å")} · {fmt(s.coverage_percent, 0, " %")}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      <main className="w-full flex-1 space-y-4 px-4 py-4 lg:px-6">
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-[15px] text-slate-600">
            <Loader2 size={16} className="animate-spin text-blue-600" />
            Recherche des structures PDB, du modèle AlphaFold et des segments transmembranaires…
          </div>
        ) : loadError ? (
          <Alert tone="rose" title="Chargement impossible">
            {loadError}
          </Alert>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                tone="blue"
                icon={<Database size={16} />}
                label="Structures PDB"
                value={`${pdbData?.total_count ?? structures.length}`}
                hint={
                  bestResolution != null
                    ? `Meilleure résolution : ${fmt(bestResolution, 2, " Å")}`
                    : structures.length
                    ? "Résolution non renseignée"
                    : "Aucune structure expérimentale"
                }
              />
              <StatCard
                tone="violet"
                icon={<Brain size={16} />}
                label="AlphaFold"
                value={alphafold?.available ? `pLDDT ${fmt(alphafold.confidence, 1)}` : "Absent"}
                hint={alphafold?.available ? alphafold.model_id || "Modèle disponible" : "Aucun modèle"}
              />
              <StatCard
                tone="amber"
                icon={<Layers size={16} />}
                label="Segments TM"
                value={`${tmSegments.length}`}
                hint={membraneData?.method || "—"}
              />
              <StatCard
                tone="emerald"
                icon={<ShieldCheck size={16} />}
                label="Structure active"
                value={source === "pdb" ? selectedPdb?.pdb_id ?? "—" : "AlphaFold"}
                hint={
                  source === "pdb" && selectedPdb
                    ? `${shortMethod(selectedPdb.method)} · couverture ${fmt(selectedPdb.coverage_percent, 0, " %")}`
                    : alphafold?.model_id || "—"
                }
              />
            </section>

            {structures.length === 0 && !alphafold?.available && (
              <Alert tone="amber" title="Aucun modèle 3D">
                Cette protéine n’a ni structure expérimentale dans le PDB ni modèle AlphaFold.
              </Alert>
            )}

            {tab === "overview" && (
              <div className="space-y-4">
                <AutoScientificInterpretation
                  accession={accession}
                  activeSource={source}
                  selectedPdb={selectedPdb}
                  alphafold={alphafold}
                  membraneData={membraneData ? { ...membraneData, is_membrane: membraneData.is_membrane ?? undefined, predicted_type: membraneData.predicted_type ?? undefined } : null}
                  qualityData={quality}
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  {selectedPdb ? (
                    <SelectedStructureCard structure={selectedPdb} length={proteinLength} />
                  ) : (
                    <EmptyCard text="Aucune structure expérimentale pour cette protéine." />
                  )}
                  {alphafold?.available ? (
                    <AlphaFoldCard
                      alphafold={alphafold}
                      accession={accession}
                      tmSegments={tmSegments}
                      onSelect={(r) => focus(r, "alphafold")}
                    />
                  ) : (
                    <EmptyCard text="Aucun modèle AlphaFold pour cette protéine." />
                  )}
                </div>
                {structures.length > 0 && proteinLength > 0 && (
                  <CoverageMap
                    structures={structures}
                    length={proteinLength}
                    tmSegments={tmSegments}
                    selected={selectedPdb}
                    onSelect={(s) => selectStructure(s)}
                  />
                )}
              </div>
            )}

            {tab === "quality" &&
              withViewer(
                <QualityTab
                  selectedPdb={selectedPdb}
                  quality={quality}
                  loading={loadingQuality}
                  activeRange={activeRange}
                  onFocusRange={(r) => focus(r, "pdb")}
                />,
                "pdb"
              )}

            {tab === "membrane" && (
              <MembraneOrientationPanel
                accession={accession}
                pdbId={selectedPdb?.pdb_id}
                activeRange={activeRange}
                onFocusRange={(r) => focus(r)}
              />
            )}

            {tab === "domains" &&
              withViewer(
                <StructuralDomains
                  accession={accession}
                  alphafold={alphafold}
                  activeRange={activeRange}
                  onFocusRange={(r) => focus(r)}
                  onClearFocus={() => setActiveRange(null)}
                />,
                source
              )}

            {tab === "active-site" &&
              withViewer(
                <ActiveSitePanel
                  pdbId={selectedPdb?.pdb_id}
                  activeRange={activeRange}
                  onFocusRange={(r) => focus({ ...r, numbering: "pdb" })}
                />,
                "pdb"
              )}

            {tab === "comparison" && (
              <div className="space-y-4">
                {alphafold?.available && structures.length > 0 && (
                  <ComparisonPanel
                    accession={accession}
                    esmfold={null}
                    alphafoldAvailable
                    models={["alphafold"]}
                    entries={structures}
                    defaultPdbId={selectedPdb?.pdb_id}
                    fileBase={accession}
                  />
                )}
                <MultiStructureComparison
                  accession={accession}
                  selectedPdb={selectedPdb}
                  alphafold={alphafold}
                  activeRange={activeRange}
                  autoHighlightRanges={tmRanges}
                />
              </div>
            )}

            {tab === "evolution" && (
              <EvolutionPanel
                accession={accession}
                pdbId={selectedPdb?.pdb_id}
                alphafoldUrl={alphafold?.available ? alphafold.pdb_url : null}
                mapping={mapping}
              />
            )}

            {tab === "prediction" && (
              <PredictedStructurePanel
                accession={accession}
                experimentalEntries={structures}
                defaultPdbId={selectedPdb?.pdb_id}
              />
            )}

            {tab === "entries" && (
              <div className="space-y-4">
                <PDBTable
                  structures={structures}
                  total={pdbData?.total_count}
                  selected={selectedPdb}
                  onSelect={(s) => selectStructure(s)}
                />
                {selectedPdb && <MacromoleculesPanel structure={selectedPdb} />}
              </div>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vue d’ensemble
// ---------------------------------------------------------------------------

function Card({
  title,
  eyebrow,
  icon,
  tone,
  actions,
  children,
}: {
  title: string;
  eyebrow: string;
  icon: React.ReactNode;
  tone: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: tone }} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md p-2 text-white shadow-sm" style={{ backgroundColor: tone }}>
            {icon}
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">{eyebrow}</p>
            <h2 className="text-[17px] font-semibold text-slate-900">{title}</h2>
          </div>
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-[14px] text-slate-500">
      {text}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</dt>
      <dd className={`truncate text-[15px] font-semibold text-slate-900 ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function SelectedStructureCard({ structure, length }: { structure: PDBStructure; length: number }) {
  const snap = structure.experimental_snapshot;
  const v = structure.validation;
  return (
    <Card
      eyebrow="Structure expérimentale"
      title={`${structure.pdb_id} · ${shortMethod(structure.method)}`}
      icon={<Database size={16} />}
      tone="#2563eb"
      actions={
        <div className="flex gap-2">
          <a
            href={`https://www.rcsb.org/structure/${structure.pdb_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            RCSB
            <ExternalLink size={12} />
          </a>
        </div>
      }
    >
      <p className="mb-3 text-[14px] leading-5 text-slate-700">{structure.title}</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Résolution" value={fmt(structure.resolution, 2, " Å")} />
        <Field label="R-free" value={fmt(snap?.r_free, 3)} />
        <Field label="R-work" value={fmt(snap?.r_work, 3)} />
        <Field label="Chaînes" value={structure.chains?.join(", ") || "—"} mono />
        <Field label="Publication" value={structure.release_date?.slice(0, 10) || "—"} />
      </dl>

      {length > 0 && (structure.coverage_ranges?.length ?? 0) > 0 && (
        <div className="mt-3">
          <CoverageSummary ranges={structure.coverage_ranges!} length={length} percent={structure.coverage_percent} />
        </div>
      )}

      <h3 className="mb-2 mt-4 text-[15px] font-semibold text-slate-900">Validation wwPDB</h3>
      <ValidationSummary
        values={{
          clashscore: v?.clashscore,
          rama: v?.ramachandran_outliers,
          rotamer: v?.sidechain_outliers,
          rsrz: v?.rsrz_outliers,
        }}
      />
    </Card>
  );
}

// Repères indicatifs inspirés des objectifs MolProbity / wwPDB (plus bas = meilleur)
const VALIDATION_METRICS = {
  clashscore: {
    label: "Clashscore",
    suffix: "",
    thresholds: [5, 10, 20],
    explain: "Chevauchements atomiques graves pour 1 000 atomes.",
  },
  rama: {
    label: "Ramachandran hors régions",
    suffix: " %",
    thresholds: [0.2, 1, 3],
    explain: "Résidus dont la conformation du squelette (φ/ψ) est improbable.",
  },
  rotamer: {
    label: "Rotamères aberrants",
    suffix: " %",
    thresholds: [1, 3, 6],
    explain: "Chaînes latérales dans une conformation rarement observée.",
  },
  rsrz: {
    label: "RSRZ aberrants",
    suffix: " %",
    thresholds: [2, 5, 10],
    explain: "Résidus mal ajustés à la densité électronique (cristallographie uniquement).",
  },
} as const;

type MetricKey = keyof typeof VALIDATION_METRICS;

const VERDICTS = [
  { label: "Excellent", className: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: <CheckCircle2 size={14} className="text-emerald-600" /> },
  { label: "Bon", className: "bg-teal-50 text-teal-800 ring-teal-200", icon: <CheckCircle2 size={14} className="text-teal-600" /> },
  { label: "Moyen", className: "bg-amber-50 text-amber-800 ring-amber-200", icon: <AlertTriangle size={14} className="text-amber-600" /> },
  { label: "Médiocre", className: "bg-rose-50 text-rose-800 ring-rose-200", icon: <XCircle size={14} className="text-rose-600" /> },
];

function verdictIndex(metric: MetricKey, value?: number | null) {
  if (value == null) return null;
  const t = VALIDATION_METRICS[metric].thresholds;
  return value <= t[0] ? 0 : value <= t[1] ? 1 : value <= t[2] ? 2 : 3;
}

function ValidationVerdict({ metric, value }: { metric: MetricKey; value?: number | null }) {
  const m = VALIDATION_METRICS[metric];
  const idx = verdictIndex(metric, value);
  const verdict = idx == null ? null : VERDICTS[idx];
  const t = m.thresholds;
  return (
    <div className="flex flex-col rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[14px] font-semibold text-slate-800">{m.label}</span>
        <span className="font-mono text-[20px] font-bold leading-none text-slate-900">
          {fmt(value, 2, m.suffix)}
        </span>
      </div>
      <span
        className={`mt-2 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold ring-1 ${
          verdict ? verdict.className : "bg-slate-50 text-slate-600 ring-slate-200"
        }`}
      >
        {verdict ? verdict.icon : <Info size={14} className="text-slate-400" />}
        {verdict ? verdict.label : "Non disponible"}
      </span>
      <p className="mt-2 text-[13px] leading-4 text-slate-600">{m.explain}</p>
      <p className="mt-1 text-[12px] text-slate-400">
        Repères : ≤ {t[0]}
        {m.suffix} excellent · ≤ {t[1]}
        {m.suffix} bon · ≤ {t[2]}
        {m.suffix} moyen
      </p>
    </div>
  );
}

function ValidationSummary({ values }: { values: Partial<Record<MetricKey, number | null | undefined>> }) {
  const keys = Object.keys(VALIDATION_METRICS) as MetricKey[];
  const available = keys.filter((k) => values[k] != null);
  const good = available.filter((k) => (verdictIndex(k, values[k]) ?? 3) <= 1).length;
  return (
    <div className="space-y-2">
      {available.length > 0 && (
        <p className="text-[14px] text-slate-700">
          <span className="font-semibold text-slate-900">
            {good} indicateur{good > 1 ? "s" : ""} sur {available.length}
          </span>{" "}
          {good > 1 ? "sont" : "est"} excellent{good > 1 ? "s" : ""} ou bon{good > 1 ? "s" : ""}.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {keys.map((k) => (
          <ValidationVerdict key={k} metric={k} value={values[k]} />
        ))}
      </div>
      <p className="text-[12px] text-slate-400">
        Valeurs calculées par wwPDB ; verdicts établis selon des repères indicatifs (objectifs
        MolProbity), qui ne tiennent pas compte de la résolution.
      </p>
    </div>
  );
}

function CoverageSummary({
  ranges,
  length,
  percent,
}: {
  ranges: { start: number; end: number }[];
  length: number;
  percent?: number | null;
}) {
  const covered = ranges.reduce((n, r) => n + (r.end - r.start + 1), 0);
  const missing: { start: number; end: number }[] = [];
  let next = 1;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start > next) missing.push({ start: next, end: r.start - 1 });
    next = Math.max(next, r.end + 1);
  }
  if (next <= length) missing.push({ start: next, end: length });

  const chip = (r: { start: number; end: number }, tone: string) => (
    <span key={`${r.start}-${r.end}`} className={`rounded px-1.5 py-0.5 font-mono text-[13px] ${tone}`}>
      {r.start}–{r.end}
      <span className="ml-1 opacity-60">({r.end - r.start + 1})</span>
    </span>
  );

  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[150px_1fr]">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">Couverture</p>
        <p className="text-[28px] font-bold leading-tight text-slate-900">{fmt(percent, 1, " %")}</p>
        <p className="text-[13px] text-slate-600">
          {covered} / {length} résidus UniProt
        </p>
      </div>
      <div className="space-y-2 text-[13px]">
        <div>
          <p className="mb-1 font-semibold text-slate-700">Régions présentes dans la structure</p>
          <div className="flex flex-wrap gap-1">{ranges.map((r) => chip(r, "bg-blue-100 text-blue-800"))}</div>
        </div>
        {missing.length > 0 && (
          <div>
            <p className="mb-1 font-semibold text-slate-700">Régions absentes</p>
            <div className="flex flex-wrap gap-1">{missing.map((r) => chip(r, "bg-white text-slate-600 ring-1 ring-slate-200"))}</div>
          </div>
        )}
        <p className="leading-4 text-slate-500">
          Les régions absentes sont souvent flexibles (extrémités, longues boucles) et non
          visibles dans les données, ou ont été retirées ou remplacées pour obtenir la structure.
        </p>
      </div>
    </div>
  );
}

const PLDDT_MEANING: Record<string, string> = {
  very_high: "Squelette et chaînes latérales très fiables.",
  confident: "Squelette généralement bien prédit.",
  low: "À interpréter avec prudence.",
  very_low: "Région souvent désordonnée : pas de conformation fiable.",
};

function PlddtDonut({
  fractions,
  mean,
}: {
  fractions: Partial<Record<string, number | null>>;
  mean?: number | null;
}) {
  const size = 150;
  const r = 58;
  const stroke = 20;
  const c = 2 * Math.PI * r;
  const gap = 2;
  const shares = PLDDT_BANDS.map((b) => fractions[b.key] ?? 0);
  const arcs = PLDDT_BANDS.map((b, i) => {
    const f = shares[i];
    const len = Math.max(f * c - gap, 0);
    const before = shares.slice(0, i).reduce((sum, v) => sum + v, 0);
    return { ...b, f, dash: `${len} ${c - len}`, offset: -before * c };
  });

  return (
    <div className="grid items-center gap-4 sm:grid-cols-[150px_1fr]">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-[150px]" role="img" aria-label="Répartition du pLDDT">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          {arcs.map((a) =>
            a.f > 0 ? (
              <circle
                key={a.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={stroke}
                strokeDasharray={a.dash}
                strokeDashoffset={a.offset}
              >
                <title>{`${a.label} : ${fmt(a.f * 100, 1, " %")}`}</title>
              </circle>
            ) : null
          )}
        </g>
        <text x={size / 2} y={size / 2 + 2} textAnchor="middle" fontSize={27} fontWeight={700} fill="#0f172a">
          {fmt(mean, 1)}
        </text>
        <text x={size / 2} y={size / 2 + 20} textAnchor="middle" fontSize={11} fill="#64748b">
          pLDDT moyen
        </text>
      </svg>
      <ul className="space-y-1.5">
        {PLDDT_BANDS.map((b) => (
          <li key={b.key} className="flex items-start gap-2 text-[13px]">
            <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: b.color }} />
            <span className="flex-1">
              <span className="font-semibold text-slate-800">{b.label}</span>
              <span className="block text-slate-500">{PLDDT_MEANING[b.key]}</span>
            </span>
            <span className="font-mono text-[14px] font-semibold text-slate-900">
              {fmt((fractions[b.key] ?? 0) * 100, 1, " %")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AlphaFoldCard({
  alphafold,
  accession,
  tmSegments,
  onSelect,
}: {
  alphafold: AlphaFoldData;
  accession: string;
  tmSegments: MembraneSegment[];
  onSelect: (range: HighlightRange) => void;
}) {
  return (
    <Card
      eyebrow="Modèle prédit"
      title={alphafold.model_id || "AlphaFold"}
      icon={<Brain size={16} />}
      tone="#7c3aed"
      actions={
        <div className="flex flex-wrap gap-2">
          {alphafold.pdb_url && (
            <a href={alphafold.pdb_url} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
              <Download size={12} />
              PDB
            </a>
          )}
          {alphafold.cif_url && (
            <a href={alphafold.cif_url} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
              <Download size={12} />
              mmCIF
            </a>
          )}
          <a
            href={`https://alphafold.ebi.ac.uk/entry/${accession}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            AlphaFold DB
            <ExternalLink size={12} />
          </a>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <dl className="grid grid-cols-3 gap-2">
            <Field label="Longueur" value={alphafold.sequence_length ? `${alphafold.sequence_length} aa` : "—"} />
            <Field label="Version" value={alphafold.latest_version ? `v${alphafold.latest_version}` : "—"} />
            <Field label="Date du modèle" value={alphafold.model_created?.slice(0, 10) || "—"} />
          </dl>

          <p className="mb-2 mt-4 text-[15px] font-semibold text-slate-900">Confiance du modèle (pLDDT)</p>
          <PlddtDonut fractions={alphafold.plddt_fractions ?? {}} mean={alphafold.confidence} />
        </div>
        {alphafold.pae_image_url && (
          <figure className="w-full sm:w-[170px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={alphafold.pae_image_url}
              alt="Erreur d’alignement prédite (PAE)"
              className="aspect-square w-full rounded-md border border-slate-200 object-contain"
            />
            <figcaption className="mt-1 text-center text-[12px] text-slate-500">
              Erreur d’alignement prédite (PAE)
            </figcaption>
          </figure>
        )}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="text-[15px] font-semibold text-slate-900">Confiance le long de la séquence</p>
        <p className="mb-2 text-[13px] text-slate-500">
          pLDDT de chaque résidu (0–100) ; les segments transmembranaires sont indiqués sous
          l’axe.
        </p>
        <PlddtProfile
          plddtUrl={alphafold.plddt_url}
          sequence={alphafold.sequence}
          tmSegments={tmSegments}
          onSelect={onSelect}
        />
      </div>
    </Card>
  );
}

function CoverageMap({
  structures,
  length,
  tmSegments,
  selected,
  onSelect,
}: {
  structures: PDBStructure[];
  length: number;
  tmSegments: MembraneSegment[];
  selected: PDBStructure | null;
  onSelect: (s: PDBStructure) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? structures : structures.slice(0, 12);
  return (
    <Card
      eyebrow="PDB"
      title="Couverture de la séquence par les structures"
      icon={<Layers size={16} />}
      tone="#0891b2"
      actions={
        structures.length > 12 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            {showAll ? "Afficher les 12 premières" : `Afficher les ${structures.length}`}
          </button>
        )
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[560px] space-y-1">
          <div className="flex items-center gap-3">
            <span className="w-[150px] shrink-0 text-right text-[13px] font-semibold text-amber-700">Segments TM</span>
            <div className="relative h-3 flex-1 rounded bg-slate-100">
              {tmSegments.map((s, i) => (
                <span
                  key={i}
                  className="absolute top-0 h-full bg-amber-500"
                  style={{ left: `${((s.start - 1) / length) * 100}%`, width: `${((s.end - s.start + 1) / length) * 100}%` }}
                  title={`${s.label || `TM${i + 1}`} : ${s.start}–${s.end}`}
                />
              ))}
            </div>
          </div>
          {rows.map((s) => (
            <button
              key={s.pdb_id}
              onClick={() => onSelect(s)}
              className={`flex w-full items-center gap-3 rounded px-0 py-0.5 text-left transition hover:bg-slate-50 ${
                selected?.pdb_id === s.pdb_id ? "bg-blue-50" : ""
              }`}
              title={`${s.pdb_id} · ${s.title}`}
            >
              <span className="w-[150px] shrink-0 truncate text-right text-[13px]">
                <span className="font-mono font-semibold text-slate-900">{s.pdb_id}</span>
                <span className="text-slate-500"> · {fmt(s.resolution, 2, " Å")}</span>
              </span>
              <span className="relative h-3 flex-1 rounded bg-slate-100">
                {(s.coverage_ranges ?? []).map((r) => (
                  <span
                    key={`${r.start}-${r.end}`}
                    className={`absolute top-0 h-full rounded-sm ${selected?.pdb_id === s.pdb_id ? "bg-blue-700" : "bg-blue-400"}`}
                    style={{ left: `${((r.start - 1) / length) * 100}%`, width: `${((r.end - r.start + 1) / length) * 100}%` }}
                  />
                ))}
              </span>
            </button>
          ))}
          <div className="flex justify-between pl-[162px] font-mono text-[12px] text-slate-400">
            <span>1</span>
            <span>{length}</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[13px] text-slate-500">
        Barres bleues : résidus de la séquence UniProt modélisés dans chaque entrée (alignement
        RCSB). Cliquez une ligne pour sélectionner la structure.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Visualisation 3D
// ---------------------------------------------------------------------------

/**
 * Vue 3D compacte d'un onglet : structure PDB sélectionnée ou modèle
 * AlphaFold, segments TM, résidus hors norme et sélection en cours.
 */
function FocusViewer({
  source,
  selectedPdb,
  alphafold,
  mapping,
  tmRanges,
  extraRanges,
  activeRange,
  setActiveRange,
}: {
  source: Source;
  selectedPdb: PDBStructure | null;
  alphafold: AlphaFoldData | null;
  mapping: ResidueMapping | null;
  tmRanges: HighlightRange[];
  extraRanges: HighlightRange[];
  activeRange: HighlightRange | null;
  setActiveRange: (r: HighlightRange | null) => void;
}) {
  const [showTM, setShowTM] = useState(true);
  const afUrl = alphafold?.available ? alphafold.pdb_url : null;
  // Structure PDB si demandée et disponible ; sinon le modèle AlphaFold
  const isPdb = (source === "pdb" || !afUrl) && !!selectedPdb;
  const isAf = !isPdb && !!afUrl;
  // Structure PDB : conversion UniProt → numérotation de la structure (SIFTS).
  // Modèle AlphaFold : même numérotation qu'UniProt, aucune conversion.
  const pdbFocus = activeRange ? mapRanges([activeRange], mapping) : [];
  const focusMissing = isPdb && !!activeRange && pdbFocus.length === 0;
  const pdbNumbered = activeRange?.numbering === "pdb";

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {isPdb ? "Structure expérimentale" : "Modèle AlphaFold"}
          </p>
          <h3 className="text-[15px] font-semibold text-slate-900">
            {isPdb ? `${selectedPdb!.pdb_id} · ${shortMethod(selectedPdb!.method)}` : alphafold?.model_id || "—"}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-700">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showTM} onChange={(e) => setShowTM(e.target.checked)} className="accent-amber-600" />
            Segments TM
          </label>
          {activeRange && (
            <button
              onClick={() => setActiveRange(null)}
              className="rounded-md border border-slate-200 px-2 py-0.5 font-medium hover:bg-slate-50"
            >
              Effacer ({activeRange.label || `${activeRange.start}–${activeRange.end}`})
            </button>
          )}
        </div>
      </div>
      {focusMissing && (
        <p className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          La sélection ({activeRange!.label || `${activeRange!.start}–${activeRange!.end}`}) n’est pas modélisée dans{" "}
          {selectedPdb?.pdb_id}. Choisissez une autre structure ou le modèle AlphaFold.
        </p>
      )}
      <div className="h-[460px]">
        {isPdb ? (
          <Structure3DViewer
            pdbId={selectedPdb!.pdb_id}
            mode="pdb"
            highlightRanges={pdbFocus}
            autoHighlightRanges={[...(showTM ? mapRanges(tmRanges, mapping) : []), ...extraRanges]}
          />
        ) : isAf ? (
          <Structure3DViewer
            pdbUrl={afUrl!}
            mode="alphafold"
            // Une sélection numérotée comme le PDB ne s'applique pas au modèle AlphaFold
            highlightRanges={activeRange && !pdbNumbered ? [activeRange] : []}
            autoHighlightRanges={showTM ? tmRanges : []}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-[15px] text-slate-400">
            Aucune structure 3D disponible.
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2 text-[12px] text-slate-600">
        {isAf ? (
          PLDDT_BANDS.map((b) => (
            <span key={b.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
              pLDDT {b.label.toLowerCase()}
            </span>
          ))
        ) : (
          <>
            <LegendDot color="#d97706" label="Segment TM" />
            {extraRanges.length > 0 && <LegendDot color={RAMA_COLORS.outlier} label="Hors régions Ramachandran" />}
          </>
        )}
        <LegendDot color="#7c3aed" label="Sélection" />
      </div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function PanelSpinner({ text }: { text: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center gap-2 text-[14px] text-slate-500">
      <Loader2 size={15} className="animate-spin text-blue-600" />
      {text}
    </div>
  );
}

// Régions de référence : identiques à la classification du serveur
const RAMA_REGIONS = [
  { label: "β", phi: [-180, -45], psi: [90, 180] },
  { label: "", phi: [-180, -45], psi: [-180, -170] },
  { label: "αR", phi: [-160, -20], psi: [-100, 50] },
  { label: "αL", phi: [30, 100], psi: [-20, 100], allowed: true },
];

function RamachandranPlot({ points, onSelect }: { points: RamaPoint[]; onSelect: (p: RamaPoint) => void }) {
  const [hover, setHover] = useState<RamaPoint | null>(null);
  const size = 300;
  const pad = 28;
  const plot = size - pad - 8;
  const x = (phi: number) => pad + ((phi + 180) / 360) * plot;
  const y = (psi: number) => 8 + ((180 - psi) / 360) * plot;

  if (!points.length) {
    return <p className="py-8 text-center text-[14px] text-slate-500">Aucun angle calculable.</p>;
  }

  // Les résidus hors régions sont dessinés en dernier pour rester visibles
  const order = { favored: 0, allowed: 1, outlier: 2 } as const;
  const sorted = [...points].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full" role="img" aria-label="Diagramme de Ramachandran">
        <rect x={pad} y={8} width={plot} height={plot} fill="#f8fafc" stroke="#e2e8f0" />
        {RAMA_REGIONS.map((r, i) => (
          <g key={i}>
            <rect
              x={x(r.phi[0])}
              y={y(r.psi[1])}
              width={x(r.phi[1]) - x(r.phi[0])}
              height={y(r.psi[0]) - y(r.psi[1])}
              fill={r.allowed ? "#fef3c7" : "#dcfce7"}
            />
            {r.label && (
              <text x={x(r.phi[0]) + 4} y={y(r.psi[1]) + 12} fontSize="11" fill="#475569" fontWeight="600">
                {r.label}
              </text>
            )}
          </g>
        ))}
        <line x1={x(0)} x2={x(0)} y1={8} y2={8 + plot} stroke="#cbd5e1" />
        <line x1={pad} x2={pad + plot} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
        {[-180, 0, 180].map((v) => (
          <g key={v}>
            <text x={x(v)} y={size - 6} fontSize="10" fill="#64748b" textAnchor="middle">
              {v}
            </text>
            <text x={pad - 4} y={y(v) + 3} fontSize="10" fill="#64748b" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x={pad + plot / 2} y={size - 6} fontSize="11" fill="#334155" textAnchor="middle" dx={40}>
          φ (°)
        </text>
        <text x={10} y={8 + plot / 2} fontSize="11" fill="#334155" textAnchor="middle" transform={`rotate(-90 10 ${8 + plot / 2})`}>
          ψ (°)
        </text>
        {sorted.map((p, i) => (
          <circle
            key={`${p.chain}-${p.resi}-${i}`}
            cx={x(p.phi)}
            cy={y(p.psi)}
            r={p.status === "favored" ? 2 : 3}
            fill={RAMA_COLORS[p.status]}
            stroke="#ffffff"
            strokeWidth={p.status === "favored" ? 0.4 : 0.8}
            className="cursor-pointer"
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(p)}
          />
        ))}
      </svg>
      <div className="mt-1 h-4 text-[13px] text-slate-600" aria-live="polite">
        {hover ? (
          <>
            <span className="font-mono font-semibold text-slate-900">
              {hover.resn}
              {hover.resi}
            </span>{" "}
            chaîne {hover.chain} · φ {hover.phi}° · ψ {hover.psi}° · {RAMA_LABELS[hover.status]}
          </>
        ) : (
          "Survolez un point ; cliquez pour le localiser en 3D."
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[13px] text-slate-600">
        {(Object.keys(RAMA_COLORS) as (keyof typeof RAMA_COLORS)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RAMA_COLORS[k] }} />
            {RAMA_LABELS[k]} ({points.filter((p) => p.status === k).length})
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Qualité
// ---------------------------------------------------------------------------

function QualityTab({
  selectedPdb,
  quality,
  loading,
  activeRange,
  onFocusRange,
}: {
  selectedPdb: PDBStructure | null;
  quality: QualityData | null;
  loading: boolean;
  activeRange: HighlightRange | null;
  onFocusRange: (r: HighlightRange) => void;
}) {
  if (!selectedPdb) {
    return <EmptyCard text="La qualité structurale s’évalue sur une structure PDB : aucune n’est disponible." />;
  }
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white">
        <PanelSpinner text={`Analyse de ${selectedPdb.pdb_id}…`} />
      </div>
    );
  }

  const geometry = quality?.geometry;
  const rama = quality?.ramachandran;
  const contacts = quality?.errat;

  return (
    <div className="space-y-4">
      {quality?.error && (
        <Alert tone="amber" title="Analyse partielle">
          {quality.error}
        </Alert>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card
            eyebrow="Référence officielle"
            title="Validation wwPDB"
            icon={<ShieldCheck size={16} />}
            tone="#059669"
            actions={
              <a
                href={`https://www.rcsb.org/structure/${selectedPdb.pdb_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Rapport complet
                <ExternalLink size={12} />
              </a>
            }
          >
            {geometry?.available === false ? (
              <p className="text-[14px] text-slate-500">Aucun rapport de validation wwPDB pour cette entrée.</p>
            ) : (
              <ValidationSummary
                values={{
                  clashscore: geometry?.clashscore,
                  rama: geometry?.rcsb_ramachandran_outliers_percent,
                  rotamer: geometry?.sidechain_outliers_percent,
                  rsrz: geometry?.rsrz_outliers_percent,
                }}
              />
            )}
          </Card>

          <Card eyebrow="Calcul local" title="Contacts atomiques anormaux" icon={<ShieldCheck size={16} />} tone="#e11d48">
            <ContactWindowsChart windows={contacts?.all_windows ?? []} activeRange={activeRange} onFocusRange={onFocusRange} />
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <Field label="Sans contact anormal" value={fmt(contacts?.score, 1, " %")} />
              <Field label="Problématiques" value={`${contacts?.bad_windows?.length ?? 0}`} />
              <Field label="À surveiller" value={`${contacts?.warning_windows?.length ?? 0}`} />
            </dl>
            <p className="mt-2 text-[13px] leading-4 text-slate-500">
              {contacts?.interpretation} Indicateur local inspiré d’ERRAT (ce n’est pas le
              programme ERRAT) ; la référence reste le clashscore wwPDB.
            </p>
          </Card>
        </div>

        <Card eyebrow="Calcul local" title="Ramachandran" icon={<Boxes size={16} />} tone="#2563eb">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,340px)_1fr]">
            <RamachandranPlot
              points={rama?.points ?? []}
              onSelect={(p) =>
                onFocusRange({ start: p.resi, end: p.resi, label: `${p.resn}${p.resi} (${p.chain})`,
                    chain: p.chain,
                    numbering: "pdb", color: "#7c3aed" })
              }
            />
            <div className="space-y-2">
              <dl className="grid gap-2">
                <Field label="Favorables" value={fmt(rama?.favored_percent, 1, " %")} />
                <Field label="Autorisés" value={fmt(rama?.allowed_percent, 1, " %")} />
                <Field label="Hors régions" value={fmt(rama?.outliers_percent, 1, " %")} />
                <Field
                  label="Hors régions (wwPDB)"
                  value={fmt(geometry?.rcsb_ramachandran_outliers_percent, 2, " %")}
                />
              </dl>
              {rama?.interpretation && (
                <p className="text-[13px] leading-4 text-slate-500">{rama.interpretation}</p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ContactWindowsChart({
  windows,
  activeRange,
  onFocusRange,
}: {
  windows: ContactWindow[];
  activeRange: HighlightRange | null;
  onFocusRange: (r: HighlightRange) => void;
}) {
  const [hover, setHover] = useState<ContactWindow | null>(null);
  if (!windows.length) {
    return <p className="py-8 text-center text-[14px] text-slate-500">Aucune fenêtre calculée.</p>;
  }

  const flagged = windows.filter((w) => w.error_value > 0).length;
  if (flagged === 0) {
    // Graphique de barres nulles illisible : on l’indique explicitement
    return (
      <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <span className="rounded-md bg-emerald-600 p-1.5 text-white">
          <ShieldCheck size={16} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-emerald-900">Aucun contact atomique anormal détecté</p>
          <p className="text-[14px] leading-5 text-emerald-900/80">
            Les {windows.length.toLocaleString("fr-FR")} fenêtres de 9 résidus analysées ne
            contiennent aucune paire d’atomes dont les sphères de van der Waals se chevauchent
            de plus de 0,5 Å.
          </p>
        </div>
      </div>
    );
  }

  const width = 720;
  const height = 160;
  // Échelle au moins jusqu’au seuil « problématique » pour situer les barres
  const max = Math.max(0.6, ...windows.map((w) => w.error_value));
  const barW = width / windows.length;
  const color = { good: "#16a34a", warning: "#d97706", bad: "#dc2626" } as const;
  const yOf = (v: number) => height - (v / max) * (height - 6);

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex h-40 flex-col justify-between py-0.5 text-right font-mono text-[12px] text-slate-400">
          <span>{max.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto rounded-md border border-slate-200 bg-white">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full min-w-[480px]" preserveAspectRatio="none" role="img" aria-label="Contacts anormaux par fenêtre de 9 résidus">
          {[0.2, 0.5].map((t) => (
            <line
              key={t}
              x1={0}
              x2={width}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke={t === 0.5 ? "#dc2626" : "#d97706"}
              strokeDasharray="4 4"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              opacity={0.6}
            />
          ))}
          {windows.map((w, i) => {
            const h = w.error_value > 0 ? Math.max(height - yOf(w.error_value), 2) : 0;
            const active = activeRange?.start === w.start && activeRange?.end === w.end;
            return (
              <rect
                key={`${w.chain}-${w.start}-${i}`}
                x={i * barW}
                y={height - h}
                width={Math.max(barW - (barW > 3 ? 1 : 0), 0.6)}
                height={h}
                fill={active ? "#7c3aed" : color[w.status]}
                className="cursor-pointer"
                onMouseEnter={() => setHover(w)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onFocusRange({ start: w.start, end: w.end, label: `Fenêtre ${w.start}–${w.end}`, color: "#7c3aed", chain: w.chain, numbering: "pdb" })}
              />
            );
          })}
        </svg>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate-600">
        <span aria-live="polite">
          {hover
            ? `Chaîne ${hover.chain ?? "?"} · résidus ${hover.start}–${hover.end} · ${hover.error_value.toLocaleString("fr-FR")} contact(s) anormal(aux) par résidu`
            : `${flagged} fenêtre(s) avec contacts anormaux sur ${windows.length} · pointillés : seuils « à surveiller » (0,2) et « problématique » (0,5) · cliquez une barre pour la localiser en 3D.`}
        </span>
        <span className="flex gap-3">
          <LegendDot color={color.good} label="Correcte" />
          <LegendDot color={color.warning} label="À surveiller" />
          <LegendDot color={color.bad} label="Problématique" />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entrées PDB
// ---------------------------------------------------------------------------

function PDBTable({
  structures,
  total,
  selected,
  onSelect,
}: {
  structures: PDBStructure[];
  total?: number;
  selected: PDBStructure | null;
  onSelect: (s: PDBStructure) => void;
}) {
  const [method, setMethod] = useState("all");
  const methods = Array.from(new Set(structures.map((s) => s.method)));
  const rows = method === "all" ? structures : structures.filter((s) => s.method === method);

  return (
    <Card
      eyebrow="RCSB PDB"
      title={`Structures expérimentales (${total ?? structures.length})`}
      icon={<Database size={16} />}
      tone="#0f4c81"
      actions={
        methods.length > 1 && (
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[14px]"
            aria-label="Filtrer par méthode"
          >
            <option value="all">Toutes les méthodes</option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {shortMethod(m)}
              </option>
            ))}
          </select>
        )
      }
    >
      {total != null && total > structures.length && (
        <p className="mb-2 text-[13px] text-slate-500">
          Les {structures.length} premières entrées sur {total} sont affichées.
        </p>
      )}
      <div className="max-h-[520px] overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-[14px]">
          <thead className="sticky top-0 bg-slate-50 text-[13px] text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">PDB</th>
              <th className="px-3 py-2 text-left font-semibold">Titre</th>
              <th className="px-3 py-2 text-left font-semibold">Méthode</th>
              <th className="px-3 py-2 text-right font-semibold">Résolution</th>
              <th className="px-3 py-2 text-right font-semibold">Couverture</th>
              <th className="px-3 py-2 text-right font-semibold">Clashscore</th>
              <th className="px-3 py-2 text-left font-semibold">Chaînes</th>
              <th className="px-3 py-2 text-right font-semibold">Date</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((s) => (
                <tr
                  key={s.pdb_id}
                  className={`border-t border-slate-100 ${selected?.pdb_id === s.pdb_id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                >
                  <td className="px-3 py-1.5">
                    <a
                      href={`https://www.rcsb.org/structure/${s.pdb_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono font-semibold text-[#0f4c81] hover:underline"
                    >
                      {s.pdb_id}
                    </a>
                  </td>
                  <td className="max-w-[420px] truncate px-3 py-1.5 text-slate-700" title={s.title}>
                    {s.title}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">{shortMethod(s.method)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(s.resolution, 2, " Å")}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(s.coverage_percent, 0, " %")}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(s.validation?.clashscore, 1)}</td>
                  <td className="px-3 py-1.5 font-mono">{s.chains?.join(", ") || "—"}</td>
                  <td className="px-3 py-1.5 text-right">{s.release_date?.slice(0, 10) || "—"}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => onSelect(s)}
                      className="inline-flex items-center gap-1 rounded bg-[#0f4c81] px-2 py-0.5 text-[13px] font-semibold text-white hover:bg-[#0c3d68]"
                    >
                      <CheckCircle2 size={12} />
                      Choisir
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="p-4 text-center text-slate-500">
                  Aucune structure PDB trouvée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MacromoleculesPanel({ structure }: { structure: PDBStructure }) {
  const molecules = structure.macromolecules ?? [];
  return (
    <Card eyebrow={structure.pdb_id} title="Entités polymères" icon={<Dna size={16} />} tone="#0891b2">
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-[14px]">
          <thead className="bg-slate-50 text-[13px] text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Entité</th>
              <th className="px-3 py-2 text-left font-semibold">Molécule</th>
              <th className="px-3 py-2 text-left font-semibold">Chaînes</th>
              <th className="px-3 py-2 text-right font-semibold">Longueur</th>
              <th className="px-3 py-2 text-left font-semibold">Organisme</th>
            </tr>
          </thead>
          <tbody>
            {molecules.length ? (
              molecules.map((m) => (
                <tr key={m.entity_id} className={`border-t border-slate-100 ${m.is_target ? "bg-blue-50/60" : ""}`}>
                  <td className="px-3 py-1.5 font-mono">{m.entity_id}</td>
                  <td className="px-3 py-1.5">
                    {m.molecule}
                    {m.is_target && (
                      <span className="ml-2 rounded bg-blue-600 px-1.5 py-0.5 text-[12px] font-semibold text-white">
                        protéine étudiée
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono">{m.chains.join(", ") || "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{m.sequence_length}</td>
                  <td className="px-3 py-1.5 italic text-slate-600">{m.organism}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-500">
                  Aucune entité décrite.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function shortMethod(method?: string) {
  const m = (method || "").toUpperCase();
  if (m.includes("X-RAY")) return "Diffraction X";
  if (m.includes("ELECTRON MICROSCOPY")) return "Cryo-EM";
  if (m.includes("SOLUTION NMR")) return "RMN en solution";
  if (m.includes("SOLID-STATE NMR")) return "RMN du solide";
  if (m.includes("ELECTRON CRYSTALLOGRAPHY")) return "Cristallographie électronique";
  if (m.includes("NEUTRON")) return "Diffraction de neutrons";
  return method || "—";
}
