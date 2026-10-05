"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowRight, Download, ExternalLink, GitBranch, Loader2 } from "lucide-react";
import Link from "next/link";
import ConservationProfile from "./ConservationProfile";
import MsaViewer from "./MsaViewer";
import TopologyDiagram from "@/components/protein/TopologyDiagram";
import { API_BASE } from "@/lib/api";
import {
  CONSURF_COLORS,
  gradeColor,
  gradeRanges,
  useConservation,
  useSequenceConservation,
  type ConservationResult,
  type ConservationSource,
} from "@/lib/conservation";
import { mapRanges, type ResidueMapping } from "@/lib/mapping";
import { downloadText, toFasta } from "@/lib/sequence";
import type { Region } from "@/lib/topology";

const Structure3DViewer = dynamic(() => import("@/components/Structure3DViewer"), { ssr: false });

const fmt = (v?: number | null, d = 2) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Analyse évolutive : homologues, alignement ancré et conservation de chaque
 * résidu. Fonctionne pour une entrée UniProt (orthologues UniRef50 ou
 * recherche étendue MMseqs2) comme pour une séquence quelconque.
 */
export default function EvolutionPanel({
  accession,
  sequence,
  name = "sequence",
  pdbId,
  alphafoldUrl,
  mapping = null,
}: {
  accession?: string | null;
  sequence?: string | null;
  name?: string;
  pdbId?: string | null;
  alphafoldUrl?: string | null;
  mapping?: ResidueMapping | null;
}) {
  const [source, setSource] = useState<ConservationSource>("uniref50");
  const byAccession = useConservation(accession, source);
  const bySequence = useSequenceConservation(accession ? null : sequence, name);
  const { status, result, error, matched } = accession ? byAccession : bySequence;
  const fileBase = accession ?? (name.replace(/[^\w.-]+/g, "_") || "sequence");
  const [focusRange, setFocusRange] = useState<{ start: number; end: number; label: string } | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const selected = focusRange && focusRange.start === focusRange.end ? focusRange.start : null;
  const setSelected = (position: number | null) =>
    setFocusRange(position ? { start: position, end: position, label: `Résidu ${position}` } : null);

  // Annotations UniProt pour le schéma de topologie
  useEffect(() => {
    if (!accession) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/domains/${accession}`)
      .then((r) => r.json())
      .then((json) => !cancelled && setRegions(json.domains ?? []))
      .catch(() => !cancelled && setRegions([]));
    return () => {
      cancelled = true;
    };
  }, [accession]);
  const [model, setModel] = useState<"pdb" | "alphafold">(pdbId ? "pdb" : "alphafold");

  // Séquence sans annotation : segments TM estimés renvoyés par le calcul
  const topologyRegions: Region[] = useMemo(() => {
    if (accession) return regions;
    return (result?.summary.regions ?? [])
      .filter((r) => r.kind === "tm")
      .map((r) => ({ start: r.start, end: r.end, type: "transmembrane" as const, label: r.label }));
  }, [accession, regions, result]);
  const has3D = !!(pdbId || alphafoldUrl);

  const colorRanges = useMemo(() => {
    if (!result) return [];
    const ranges = gradeRanges(result.positions);
    // Structure PDB : numérotation convertie (SIFTS) ; AlphaFold : identique à UniProt
    return model === "pdb" ? mapRanges(ranges, mapping) : ranges;
  }, [result, model, mapping]);

  const focus = useMemo(() => {
    if (!focusRange) return [];
    const range = { ...focusRange, color: "#7c3aed" };
    return model === "pdb" ? mapRanges([range], mapping) : [range];
  }, [focusRange, model, mapping]);

  if (status !== "succeeded" || !result) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        {status === "failed" ? (
          <p className="flex items-start gap-2 text-[15px] text-rose-700">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            Analyse évolutive impossible : {error}
          </p>
        ) : (
          <div className="flex items-start gap-3 text-[15px] text-slate-600">
            <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-violet-600" />
            <div>
              <p className="font-semibold text-slate-900">
                {status === "running" ? "Recherche et alignement des homologues en cours…" : "Calcul en file d’attente…"}
              </p>
              <p className="text-[14px]">
                {accession && source === "uniref50"
                  ? "Collecte des orthologues (UniRef50), alignement et calcul de la conservation : quelques secondes."
                  : "Recherche d’homologues MMseqs2 dans UniRef, puis calcul de la conservation : de 20 secondes à quelques minutes selon la charge du serveur."}{" "}
                Le résultat est ensuite conservé.
              </p>
            </div>
          </div>
        )}
        {accession && <SourceSwitch source={source} onChange={setSource} />}
      </section>
    );
  }

  const s = result.summary;
  const tmGain = s.tm_mean_score != null && s.loop_mean_score != null ? s.tm_mean_score - s.loop_mean_score : null;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="rounded-md bg-violet-600 p-2 text-white shadow-sm">
              <GitBranch size={16} />
            </span>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-violet-700">Évolution</p>
              <h2 className="text-[17px] font-semibold text-slate-900">Conservation des résidus</h2>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {accession && <SourceSwitch source={source} onChange={setSource} />}
            <ExportButton label="Conservation (CSV)" onClick={() => exportCsv(fileBase, result)} />
            <ExportButton label="Alignement (FASTA)" onClick={() => exportFasta(fileBase, result)} />
          {result.cluster_id ? (
            <a
              href={`https://www.uniprot.org/uniref/${result.cluster_id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
            >
              {result.cluster_id}
              <ExternalLink size={12} />
            </a>
          ) : (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-[13px] font-medium text-slate-700">
              MMseqs2 · {result.cluster_size ?? "?"} homologues trouvés
            </span>
          )}
          </div>
        </div>

        {matched && (
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[14px] text-emerald-900">
            <span>
              Séquence identique à l’entrée UniProt <span className="font-mono font-semibold">{matched.accession}</span>
              {matched.reviewed ? " (Swiss-Prot)" : ""} : l’analyse porte sur cette entrée.
            </span>
            <Link
              href={`/structures/${matched.accession}?tab=evolution`}
              className="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline"
            >
              Analyse structurale et 3D
              <ArrowRight size={14} />
            </Link>
          </div>
        )}

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Séquences alignées"
            value={`${result.sequence_count}`}
            hint={result.species_count ? `${result.species_count} espèces` : result.source === "mmseqs" ? "homologues MMseqs2" : "—"}
          />
          <Stat label="Conservation dans la membrane" value={fmt(s.tm_mean_score)} hint="score moyen des segments TM" />
          <Stat label="Conservation hors membrane" value={fmt(s.loop_mean_score)} hint="boucles et extrémités" />
          <Stat
            label="Écart membrane / boucles"
            value={tmGain == null ? "—" : `${tmGain >= 0 ? "+" : ""}${fmt(tmGain)}`}
            hint={tmGain == null ? "aucun segment TM annoté" : tmGain > 0 ? "la membrane est plus conservée" : "les boucles sont plus conservées"}
          />
        </div>

        {result.warnings.map((w) => (
          <p key={w} className="mx-4 mb-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {w}
          </p>
        ))}

        <div className="border-t border-slate-100 px-4 py-3">
          <ConservationProfile
            positions={result.positions}
            tmSegments={s.tm_segments}
            selected={selected}
            onSelect={(p) => setSelected(p.position)}
          />
          <GradeLegend />
        </div>
      </section>

      {(hasMembrane(topologyRegions) || s.regions.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          {hasMembrane(topologyRegions) && (
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-[16px] font-semibold text-slate-900">Topologie colorée par conservation</h3>
              <p className="mb-2 text-[13px] text-slate-500">
                Chaque résidu des hélices et des boucles prend la couleur de son grade.
              </p>
              <TopologyDiagram
                regions={topologyRegions}
                length={result.length}
                residueColor={(position) => {
                  const p = result.positions[position - 1];
                  return p ? gradeColor(p.grade) : undefined;
                }}
                onSelect={(range) => setFocusRange({ start: range.start, end: range.end, label: range.label || "Région" })}
              />
            </section>
          )}
          {s.regions.length > 0 && <RegionChart result={result} onSelect={setFocusRange} active={focusRange} />}
        </div>
      )}

      <div className={`grid gap-4 ${has3D ? "xl:grid-cols-[1.2fr_1fr]" : ""}`}>
        {has3D && (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <h3 className="text-[16px] font-semibold text-slate-900">Conservation en 3D</h3>
            <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-[13px]">
              {(
                [
                  ["pdb", pdbId ? `PDB ${pdbId}` : "PDB", !!pdbId],
                  ["alphafold", "AlphaFold", !!alphafoldUrl],
                ] as const
              ).map(([key, label, enabled]) => (
                <button
                  key={key}
                  disabled={!enabled}
                  onClick={() => setModel(key)}
                  className={`rounded px-2.5 py-1 font-semibold disabled:opacity-40 ${model === key ? "bg-white shadow-sm" : "text-slate-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[460px]">
            {model === "pdb" && pdbId ? (
              <Structure3DViewer pdbId={pdbId} mode="pdb" colorRanges={colorRanges} highlightRanges={focus} />
            ) : alphafoldUrl ? (
              <Structure3DViewer pdbUrl={alphafoldUrl} mode="pdb" colorRanges={colorRanges} highlightRanges={focus} />
            ) : (
              <p className="p-6 text-[14px] text-slate-500">Aucune structure disponible.</p>
            )}
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-[13px] text-slate-500">
            Turquoise : positions variables · bordeaux : positions conservées · gris : régions sans
            correspondance dans l’alignement.
          </p>
        </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-[16px] font-semibold text-slate-900">Positions les plus conservées</h3>
          <p className="mb-2 text-[13px] text-slate-500">Cliquez une position pour la localiser.</p>
          <div className="flex flex-wrap gap-1.5">
            {s.most_conserved.map((p) => (
              <button
                key={p.position}
                onClick={() => setSelected(p.position)}
                className={`rounded px-2 py-0.5 font-mono text-[13px] font-semibold ${
                  selected === p.position ? "bg-violet-600 text-white" : "bg-[#a02560] text-white hover:opacity-85"
                }`}
              >
                {p.residue}
                {p.position}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-5 text-slate-500">
            Méthode : {result.method}. Les grades sont relatifs à la protéine (1 = 11 % des
            positions les plus variables, 9 = 11 % les plus conservées). Le score favorise les
            acides aminés rares (Trp, Cys, Met) à conservation égale.
          </p>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-[16px] font-semibold text-slate-900">
          Alignement multiple ({result.msa.length} séquences affichées)
        </h3>
        <MsaViewer
          query={result.query_sequence}
          rows={result.msa}
          positions={result.positions}
          selected={selected}
          onSelect={setSelected}
          regions={result.summary.regions}
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-[16px] font-semibold text-slate-900">Homologues ({result.homologs.length})</h3>
        <div className="max-h-[420px] overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-[14px]">
            <thead className="sticky top-0 bg-slate-50 text-[13px] text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Espèce</th>
                <th className="px-3 py-2 text-left font-semibold">Entrée</th>
                <th className="px-3 py-2 text-right font-semibold">Identité</th>
                <th className="px-3 py-2 text-right font-semibold">Couverture</th>
                <th className="px-3 py-2 text-right font-semibold">Longueur</th>
              </tr>
            </thead>
            <tbody>
              {result.homologs.map((h) => (
                <tr key={h.accession} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 italic text-slate-700">{h.organism ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <a
                      href={h.link ?? `https://www.uniprot.org/uniprotkb/${h.accession}/entry`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[#0f4c81] hover:underline"
                    >
                      {h.accession}
                    </a>
                    {h.reviewed && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-800">Swiss-Prot</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{Math.round(h.identity * 100)} %</td>
                  <td className="px-3 py-1.5 text-right font-mono">{Math.round(h.coverage * 100)} %</td>
                  <td className="px-3 py-1.5 text-right font-mono">{h.length ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="text-[22px] font-bold text-slate-900">{value}</p>
      <p className="text-[13px] text-slate-500">{hint}</p>
    </div>
  );
}

function GradeLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
      <span>Variable</span>
      <span className="flex overflow-hidden rounded ring-1 ring-slate-200">
        {CONSURF_COLORS.map((c, i) => (
          <span key={c} className="flex h-5 w-6 items-center justify-center text-[11px] font-semibold" style={{ backgroundColor: c, color: i >= 7 ? "white" : "#0f172a" }}>
            {i + 1}
          </span>
        ))}
      </span>
      <span>Conservé</span>
      <span className="ml-auto text-slate-400">Grades de conservation (palette ConSurf)</span>
    </div>
  );
}

function hasMembrane(regions: Region[]) {
  return regions.some((r) => r.type === "transmembrane" || r.type === "intramembrane");
}

function exportCsv(accession: string, result: ConservationResult) {
  const header = "position,residu,grade,score,frequence_residu,fraction_gaps,residus_observes";
  const lines = result.positions.map((p) =>
    [
      p.position,
      p.residue,
      p.grade,
      p.score,
      p.query_residue_frequency,
      p.gap_fraction,
      `"${p.top_residues.map((r) => `${r.residue}:${r.frequency}`).join(" ")}"`,
    ].join(",")
  );
  downloadText(`${accession}_conservation.csv`, [header, ...lines].join("\n"), "text/csv");
}

function exportFasta(accession: string, result: ConservationResult) {
  const records = [
    toFasta(`${accession} protéine étudiée`, result.query_sequence),
    ...result.msa.map((r) => toFasta(`${r.accession} ${r.organism}`, r.row)),
  ];
  downloadText(`${accession}_alignement.fasta`, records.join(""));
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
    >
      <Download size={13} />
      {label}
    </button>
  );
}

const REGION_TONE: Record<string, string> = {
  tm: "#d97706",
  intramembrane: "#9a3412",
  loop_out: "#e11d48",
  loop_in: "#2563eb",
  loop: "#64748b",
};

/** Conservation moyenne de chaque région membranaire, dans l'ordre de la séquence. */
function RegionChart({
  result,
  onSelect,
  active,
}: {
  result: ConservationResult;
  onSelect: (range: { start: number; end: number; label: string }) => void;
  active: { start: number; end: number } | null;
}) {
  const regions = result.summary.regions;
  const max = Math.max(...regions.map((r) => r.mean_score ?? 0), 0.01);
  const best = regions.reduce((a, b) => ((b.mean_score ?? 0) > (a.mean_score ?? 0) ? b : a), regions[0]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-[16px] font-semibold text-slate-900">Conservation par région</h3>
      <p className="mb-3 text-[13px] text-slate-500">
        Score moyen de chaque région · la plus conservée :{" "}
        <span className="font-semibold text-slate-800">
          {best.label} ({best.start}–{best.end})
        </span>
      </p>
      <ul className="space-y-1.5">
        {regions.map((r) => {
          const isActive = active?.start === r.start && active?.end === r.end;
          return (
            <li key={`${r.start}-${r.end}`}>
              <button
                onClick={() => onSelect({ start: r.start, end: r.end, label: r.label })}
                className={`grid w-full grid-cols-[150px_1fr_52px] items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] hover:bg-slate-50 ${
                  isActive ? "bg-violet-50 ring-1 ring-violet-200" : ""
                }`}
                title={`${r.label} : résidus ${r.start}–${r.end} (${r.length} aa)`}
              >
                <span className="flex items-center gap-1.5 truncate text-slate-700">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: REGION_TONE[r.kind] ?? "#64748b" }} />
                  {r.label}
                </span>
                <span className="h-3 rounded-sm bg-slate-100">
                  <span className="block h-full rounded-sm bg-violet-600" style={{ width: `${((r.mean_score ?? 0) / max) * 100}%` }} />
                </span>
                <span className="text-right font-mono text-slate-900">
                  {(r.mean_score ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[12px] text-slate-400">
        Carré de couleur : orange = hélice TM, brun = intramembranaire, rose = boucle extérieure,
        bleu = boucle cytoplasmique. Cliquez une région pour la voir en 3D.
      </p>
    </section>
  );
}

function SourceSwitch({ source, onChange }: { source: ConservationSource; onChange: (s: ConservationSource) => void }) {
  return (
    <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-[13px]" role="radiogroup" aria-label="Source des homologues">
      {(
        [
          ["uniref50", "Orthologues proches", "UniRef50 : séquences à au moins 50 % d’identité, rapide"],
          ["mmseqs", "Recherche étendue", "MMseqs2 : homologues plus lointains, jusqu’à 1 000 séquences"],
        ] as const
      ).map(([key, label, title]) => (
        <button
          key={key}
          role="radio"
          aria-checked={source === key}
          title={title}
          onClick={() => onChange(key)}
          className={`rounded px-2.5 py-1 font-semibold ${source === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
