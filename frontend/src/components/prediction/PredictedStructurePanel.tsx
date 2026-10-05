"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, Brain, CheckCircle2, Info, Loader2, Play } from "lucide-react";
import Membrane3DViewer from "@/components/Membrane3DViewer";
import ComparisonPanel, { type ExperimentalEntry } from "./ComparisonPanel";
import TopologyDiagram from "@/components/protein/TopologyDiagram";
import { Panel } from "@/components/ui";
import {
  PLDDT_BANDS,
  TOPOLOGY_SOURCE_LABELS,
  plddtColor,
  usePredictedStructure,
  useSequencePrediction,
  type InterpretationNote,
  type KnownTopology,
  type MembraneResidue,
  type PredictionResult,
} from "@/lib/prediction";
import type { Region } from "@/lib/topology";

type Range = { start: number; end: number; label: string; color?: string };

const fmt = (v?: number | null, d = 0) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const confidenceLabel = (v?: number | null) =>
  v == null ? "inconnue" : v >= 90 ? "très élevée" : v >= 70 ? "élevée" : v >= 50 ? "faible" : "très faible";

/**
 * Structure prédite par ESMFold, placée dans la membrane par le serveur, avec
 * une lecture biologique en phrases. Fonctionne pour une entrée UniProt
 * (topologie DeepTMHMM ou UniProt) comme pour une séquence quelconque.
 */
export default function PredictedStructurePanel({
  accession,
  sequence,
  name = "sequence",
  topology = null,
  autoStart = true,
  experimentalEntries = [],
  defaultPdbId = null,
}: {
  accession?: string | null;
  sequence?: string | null;
  name?: string;
  /** Séquence quelconque : topologie connue (DeepTMHMM) ; sinon estimée par le serveur. */
  topology?: KnownTopology | null;
  autoStart?: boolean;
  /** Structures PDB de l'entrée, proposées pour la superposition. */
  experimentalEntries?: ExperimentalEntry[];
  defaultPdbId?: string | null;
}) {
  const [launched, setLaunched] = useState(autoStart);
  const [start, setStart] = useState<number | null>(null);
  const byAccession = usePredictedStructure(launched && accession ? accession : null, start);
  const bySequence = useSequencePrediction(launched && !accession ? sequence : null, name, topology, start);
  const { status, result, error, job } = accession ? byAccession : bySequence;
  const fileBase = (accession ?? name).replace(/[^\w.-]+/g, "_") || "sequence";

  const header = {
    tone: "cyan" as const,
    icon: <Brain size={16} />,
    label: "IA · ESMFold",
    title: "Structure prédite dans la membrane",
  };

  if (!launched) {
    return (
      <Panel {...header}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-[14px] leading-5 text-slate-600">
            ESMFold prédit la structure 3D à partir de la seule séquence (jusqu’à 400 résidus par
            modèle). La structure est ensuite placée dans la bicouche et commentée : hélices,
            côté cytoplasmique, résidus remarquables. Compter de 10 secondes à quelques minutes.
          </p>
          <button
            onClick={() => setLaunched(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-[14px] font-semibold text-white hover:bg-cyan-800"
          >
            <Play size={14} />
            Prédire la structure
          </button>
        </div>
      </Panel>
    );
  }

  const done = status === "succeeded" && result;
  // Superposition du modèle ESMFold avec le cristal (AlphaFold : onglet « PDB / AlphaFold »)
  const canCompare = !!accession && experimentalEntries.length > 0 && !!done && !!job?.id;
  const main = done ? (
    <Result
      result={result}
      fileBase={fileBase}
      header={{
        ...header,
        actions: canCompare ? (
          <a
            href="#superposition"
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[14px] font-semibold text-white hover:bg-violet-700"
          >
            <ArrowDown size={14} />
            Superposition avec le cristal
          </a>
        ) : undefined,
      }}
      onWindow={(s) => setStart(s)}
    />
  ) : (
    <Panel {...header}>
      {status === "failed" ? (
        <p className="flex items-start gap-2 text-[15px] text-rose-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          Prédiction impossible : {error}
        </p>
      ) : (
        <div className="flex items-start gap-3 text-[15px] text-slate-600">
          <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-cyan-600" />
          <div>
            <p className="font-semibold text-slate-900">
              {status === "running" ? "Prédiction ESMFold en cours…" : "Calcul en file d’attente…"}
            </p>
            <p className="text-[14px]">
              Repliement par ESMFold (ESM Metagenomic Atlas), puis placement dans la membrane : de 10
              secondes à quelques minutes selon la longueur et la charge du service. Le résultat est
              ensuite conservé.
            </p>
          </div>
        </div>
      )}
    </Panel>
  );

  return (
    <div className="space-y-4">
      {main}
      {canCompare && (
        <ComparisonPanel
          accession={accession!}
          esmfold={{ jobId: job!.id, result: result! }}
          alphafoldAvailable={false}
          models={["esmfold"]}
          entries={experimentalEntries}
          defaultPdbId={defaultPdbId}
          fileBase={fileBase}
        />
      )}
    </div>
  );
}

function Result({
  result,
  fileBase,
  header,
  onWindow,
}: {
  result: PredictionResult;
  fileBase: string;
  header: Omit<React.ComponentProps<typeof Panel>, "children">;
  onWindow: (start: number) => void;
}) {
  const [focus, setFocus] = useState<Range | null>(null);
  const helices = result.helices ?? [];
  const membrane = result.membrane;
  const crossing = helices.filter((h) => h.crosses).length;
  const plddtByNumber = useMemo(() => new Map(result.residues.map((r) => [r.number, r.plddt])), [result]);

  const subunits = useMemo(
    () => [{ chain: "A", segments: helices.map((h) => ({ start: h.start, end: h.end })) }],
    [helices]
  );

  // Schéma de topologie : hélices et côté de chaque boucle d'après le placement
  const regions: Region[] = useMemo(
    () =>
      (result.regions ?? []).map((r) =>
        r.kind === "tm"
          ? { start: r.start, end: r.end, type: "transmembrane" as const, label: r.label }
          : { start: r.start, end: r.end, type: "topological" as const, label: r.side === "in" ? "Cytoplasmic" : "Extracellular" }
      ),
    [result]
  );

  const toggle = (range: Range) =>
    setFocus((current) => (current?.start === range.start && current?.end === range.end ? null : range));

  return (
    <div className="space-y-4">
      <Panel {...header}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Confiance moyenne"
            value={`pLDDT ${fmt(result.mean_plddt)}`}
            hint={`${confidenceLabel(result.mean_plddt)} · membrane ${fmt(result.tm_mean_plddt)} · boucles ${fmt(result.loop_mean_plddt)}`}
          />
          <Stat
            label="Épaisseur hydrophobe"
            value={membrane ? `${fmt(membrane.thickness)} Å` : "—"}
            hint={membrane ? (membrane.at_search_limit ? "estimation à la limite de la recherche" : "bicouche ajustée") : "structure non placée"}
          />
          <Stat
            label="Hélices transmembranaires"
            value={membrane ? `${crossing} / ${helices.length}` : "0"}
            hint="traversent la bicouche"
          />
          <Stat
            label={result.window.start === 1 ? "Extrémité N-terminale" : `Résidu ${result.window.start}`}
            value={membrane ? (membrane.n_terminus === "in" ? "Cytoplasme" : "Extérieur") : "—"}
            hint={
              membrane
                ? membrane.side_method === "topology"
                  ? `d’après ${TOPOLOGY_SOURCE_LABELS[result.tm_source]}`
                  : `règle « positive-inside » (${membrane.kr_inside} K/R contre ${membrane.kr_outside})`
                : "—"
            }
          />
        </div>

        {!result.window.complete && (
          <WindowNotice
            key={result.window.start}
            length={result.length}
            window={result.window}
            segments={result.tm_segments}
            onWindow={onWindow}
          />
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <section>
          <Membrane3DViewer
            coordinates={result.pdb}
            downloadName={`${fileBase}_esmfold_membrane.pdb`}
            subunits={subunits}
            outsideLabel="Côté externe"
            insideLabel="Côté cytoplasmique"
            tmLegend={`Segments TM (${TOPOLOGY_SOURCE_LABELS[result.tm_source]})`}
            defaultColorMode="plddt"
            activeRange={focus}
          />
          <p className="mt-1.5 text-[13px] text-slate-500">
            Coordonnées réorientées comme dans OPM : membrane horizontale, face externe en haut
            (points rouges), face interne en bas (points bleus).
          </p>
        </section>
        <Interpretation notes={result.interpretation} />
      </div>

      {membrane && (
        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">Topologie colorée par confiance</h3>
            <p className="mb-2 text-[13px] text-slate-500">
              Côtés des boucles d’après le placement 3D ; chaque résidu prend la couleur de son pLDDT.
              Les résidus hors de la région modélisée restent gris.
            </p>
            <TopologyDiagram
              regions={regions}
              length={result.length}
              activeRange={focus}
              sidesSource="le placement de la structure prédite"
              residueColor={(position) => {
                const score = plddtByNumber.get(position);
                return score == null ? "#e2e8f0" : plddtColor(score);
              }}
              onSelect={(range) => toggle({ start: range.start, end: range.end, label: range.label || "Région" })}
            />
            <PlddtLegend />
          </section>
          <HelixTable helices={helices} focus={focus} onSelect={toggle} />
        </div>
      )}

      {membrane && (
        <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
          <ResidueList
            title="Ceinture aromatique"
            hint="Trp et Tyr à moins de 5 Å d’une face de la bicouche : ancrage aux interfaces."
            residues={result.aromatic_belt ?? []}
            color="#0f766e"
            empty="Aucun Trp ni Tyr aux interfaces."
            focus={focus}
            onSelect={toggle}
          />
          <ResidueList
            title="Résidus chargés au cœur de la membrane"
            hint="Asp, Glu, Lys, Arg, His à plus de 5 Å des faces : souvent fonctionnels."
            residues={result.buried_charged ?? []}
            color="#be123c"
            empty="Aucun résidu chargé enfoui dans la bicouche."
            focus={focus}
            onSelect={toggle}
          />
        </section>
      )}

      <p className="text-[13px] leading-5 text-slate-500">
        Méthode : {result.method}. Segments transmembranaires : {TOPOLOGY_SOURCE_LABELS[result.tm_source]}.
        Région modélisée : résidus {result.window.start}–{result.window.end} sur {result.length}. Le pLDDT
        (0–100) mesure la confiance locale du modèle ; il ne dit rien de la position dans la membrane.
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="text-[22px] font-bold text-slate-900">{value}</p>
      <p className="truncate text-[13px] text-slate-500" title={hint}>
        {hint}
      </p>
    </div>
  );
}

function WindowNotice({
  length,
  window,
  segments,
  onWindow,
}: {
  length: number;
  window: PredictionResult["window"];
  segments: PredictionResult["tm_segments"];
  onWindow: (start: number) => void;
}) {
  const maxStart = Math.max(1, length - window.max_length + 1);
  const [value, setValue] = useState(window.start);
  const outside = segments.filter((s) => s.end < window.start || s.start > window.end).length;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
      <p className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          La protéine compte {length} résidus : ESMFold n’en modélise que {window.max_length}. Région
          choisie : {window.start}–{window.end}
          {outside > 0 ? `, ${outside} segment(s) transmembranaire(s) restent hors du modèle.` : ", qui contient tous les segments transmembranaires."}
        </span>
      </p>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onWindow(Math.min(maxStart, Math.max(1, value)));
        }}
      >
        <label className="flex items-center gap-1.5">
          Début
          <input
            type="number"
            min={1}
            max={maxStart}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-20 rounded border border-amber-300 bg-white px-1.5 py-0.5 font-mono text-slate-900"
          />
        </label>
        <button className="rounded-md bg-amber-600 px-2.5 py-1 text-[13px] font-semibold text-white hover:bg-amber-700">
          Modéliser cette région
        </button>
      </form>
    </div>
  );
}

const NOTE_STYLE = {
  good: { icon: <CheckCircle2 size={16} />, className: "border-emerald-200 bg-emerald-50", iconClass: "text-emerald-600" },
  warning: { icon: <AlertTriangle size={16} />, className: "border-amber-200 bg-amber-50", iconClass: "text-amber-600" },
  info: { icon: <Info size={16} />, className: "border-slate-200 bg-slate-50", iconClass: "text-slate-500" },
} as const;

function Interpretation({ notes }: { notes: InterpretationNote[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-[16px] font-semibold text-slate-900">Lecture biologique</h3>
      <p className="mb-3 text-[13px] text-slate-500">
        Déduite de la structure par des règles explicites : à confronter aux données expérimentales.
      </p>
      <ul className="space-y-2">
        {notes.map((note, i) => {
          const style = NOTE_STYLE[note.level] ?? NOTE_STYLE.info;
          return (
            <li key={`${i}-${note.title}`} className={`flex gap-2.5 rounded-md border px-3 py-2 ${style.className}`}>
              <span className={`mt-0.5 shrink-0 ${style.iconClass}`}>{style.icon}</span>
              <div>
                <p className="text-[14px] font-semibold text-slate-900">{note.title}</p>
                <p className="text-[14px] leading-5 text-slate-700">{note.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HelixTable({
  helices,
  focus,
  onSelect,
}: {
  helices: NonNullable<PredictionResult["helices"]>;
  focus: Range | null;
  onSelect: (range: Range) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-[16px] font-semibold text-slate-900">Hélices dans la bicouche</h3>
      <p className="mb-2 text-[13px] text-slate-500">
        Inclinaison par rapport à la normale ; cliquez une hélice pour la voir en 3D.
      </p>
      <div className="overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-[14px]">
          <thead className="bg-slate-50 text-[13px] text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Hélice</th>
              <th className="px-3 py-2 text-left font-semibold">Résidus</th>
              <th className="px-3 py-2 text-right font-semibold">Inclinaison</th>
              <th className="px-3 py-2 text-left font-semibold">Sens</th>
              <th className="px-3 py-2 text-right font-semibold">pLDDT</th>
            </tr>
          </thead>
          <tbody>
            {helices.map((h) => {
              const active = focus?.start === h.helix_start && focus?.end === h.helix_end;
              return (
                <tr
                  key={h.label}
                  onClick={() => onSelect({ start: h.helix_start, end: h.helix_end, label: h.label })}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${active ? "bg-cyan-50" : ""}`}
                >
                  <td className="px-3 py-1.5 font-semibold text-slate-900">
                    {h.label}
                    {h.crossing !== "full" && (
                      <span
                        className={`ml-1.5 rounded px-1 text-[11px] font-semibold ${
                          h.crossing === "short" ? "bg-slate-100 text-slate-700" : "bg-amber-100 text-amber-800"
                        }`}
                        title={
                          h.crossing === "short"
                            ? `Une extrémité s’arrête dans la bicouche (${fmt(Math.min(Math.abs(h.reach_start), Math.abs(h.reach_end)))} Å du centre) ; la boucle voisine termine la traversée`
                            : "Ne traverse pas la bicouche : hélice réentrante ou d’interface"
                        }
                      >
                        {h.crossing === "short" ? "courte" : "partielle"}
                      </span>
                    )}
                  </td>
                  <td
                    className="px-3 py-1.5 font-mono text-slate-700"
                    title={`Segment transmembranaire prédit ${h.start}–${h.end} · hélice dans la structure ${h.helix_start}–${h.helix_end}`}
                  >
                    {h.helix_start}–{h.helix_end}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono ${h.tilt >= 30 ? "font-semibold text-amber-700" : ""}`}>
                    {fmt(h.tilt)}°
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">{h.direction === "in_to_out" ? "int. → ext." : "ext. → int."}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: plddtColor(h.mean_plddt ?? 0) }} />
                      {fmt(h.mean_plddt)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResidueList({
  title,
  hint,
  residues,
  color,
  empty,
  focus,
  onSelect,
}: {
  title: string;
  hint: string;
  residues: MembraneResidue[];
  color: string;
  empty: string;
  focus: Range | null;
  onSelect: (range: Range) => void;
}) {
  return (
    <div>
      <h3 className="text-[16px] font-semibold text-slate-900">
        {title} ({residues.length})
      </h3>
      <p className="mb-2 text-[13px] text-slate-500">{hint}</p>
      {residues.length ? (
        <div className="flex flex-wrap gap-1.5">
          {residues.map((r) => {
            const active = focus?.start === r.number && focus?.end === r.number;
            const label = `${r.aa}${r.number}`;
            return (
              <button
                key={r.number}
                onClick={() => onSelect({ start: r.number, end: r.number, label, color })}
                title={`${label} · z = ${fmt(r.z, 1)} Å${r.face ? ` · face ${r.face}` : ""} · pLDDT ${fmt(r.plddt)}`}
                className="rounded px-2 py-0.5 font-mono text-[13px] font-semibold text-white hover:opacity-85"
                style={{ backgroundColor: active ? "#7c3aed" : color }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-[14px] text-slate-500">{empty}</p>
      )}
    </div>
  );
}

function PlddtLegend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-600">
      {PLDDT_BANDS.map((b) => (
        <span key={b.min} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
          {b.label}
        </span>
      ))}
    </div>
  );
}
