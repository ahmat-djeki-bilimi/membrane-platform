"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, ExternalLink, Layers, Loader2, Waves } from "lucide-react";
import { API_BASE } from "@/lib/api";
import Membrane3DViewer, { type OPMSubunit } from "@/components/Membrane3DViewer";
import TopologyDiagram from "@/components/protein/TopologyDiagram";
import type { Region } from "@/lib/topology";

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type TMSegment = { start: number; end: number; label?: string; source?: string };

type OrientationResponse = {
  accession: string;
  available: boolean;
  sequence_length: number;
  method: string;
  tm_segments: TMSegment[];
  orientation: {
    tm_count: number;
    n_terminus: "in" | "out" | null;
    c_terminus: "in" | "out" | null;
    topology: string;
    interpretation?: string;
  };
};

type OPMResponse = {
  pdb_id: string;
  available: boolean;
  opm_id?: number;
  opm_pdb_id?: string;
  is_representative?: boolean;
  url?: string;
  oriented_pdb_url?: string;
  name?: string;
  resolution?: string | null;
  type?: string;
  class?: string;
  superfamily?: string;
  superfamily_pfam?: string | null;
  family?: string;
  family_pfam?: string | null;
  family_interpro?: string | null;
  family_tcdb?: string | null;
  species?: string;
  species_lineage?: string;
  membrane?: string;
  topology_in?: string;
  topology_out?: string;
  reference_chain?: string;
  n_terminus?: "in" | "out" | null;
  hydrophobic_thickness?: number | null;
  thickness_error?: number | null;
  tilt_angle?: number | null;
  tilt_error?: number | null;
  delta_g_transfer?: number | null;
  subunits?: OPMSubunit[];
  uniprot_codes?: string[];
  comments?: string | null;
  verification?: string | null;
  citations?: { text: string; pmid: string | null }[];
  secondary_representations?: { pdb_id: string; resolution: string | null }[];
  message?: string;
};

const SIDE = { in: "cytoplasmique", out: "extracellulaire / luminale" } as const;

export default function MembraneOrientationPanel({
  accession,
  pdbId,
  activeRange,
  onFocusRange,
}: {
  accession: string;
  pdbId?: string | null;
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  const [orientation, setOrientation] = useState<OrientationResponse | null>(null);
  const [opm, setOpm] = useState<OPMResponse | null>(null);
  const [loadingOrientation, setLoadingOrientation] = useState(false);
  const [loadingOpm, setLoadingOpm] = useState(false);
  const [regions, setRegions] = useState<Region[]>([]);

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

  useEffect(() => {
    if (!accession) return;
    let cancelled = false;
    setLoadingOrientation(true);
    fetch(`${API_BASE}/api/membrane-orientation/${accession}`)
      .then((r) => r.json())
      .then((json) => !cancelled && setOrientation(json))
      .catch(() => !cancelled && setOrientation(null))
      .finally(() => !cancelled && setLoadingOrientation(false));
    return () => {
      cancelled = true;
    };
  }, [accession]);

  useEffect(() => {
    setOpm(null);
    if (!pdbId) return;
    let cancelled = false;
    setLoadingOpm(true);
    fetch(`${API_BASE}/api/opm/${pdbId}`)
      .then((r) => r.json())
      .then((json) => !cancelled && setOpm(json))
      .catch(() => !cancelled && setOpm(null))
      .finally(() => !cancelled && setLoadingOpm(false));
    return () => {
      cancelled = true;
    };
  }, [pdbId]);

  const opmOk = !!opm?.available;

  if (!pdbId) {
    return (
      <div className="space-y-4">
        <Notice>Sélectionnez une structure PDB pour afficher son orientation calculée par OPM.</Notice>
        <UniProtTopology
          regions={regions}
          orientation={orientation}
          loading={loadingOrientation}
          activeRange={activeRange}
          onFocusRange={onFocusRange}
        />
      </div>
    );
  }

  if (loadingOpm) {
    return (
      <div className="flex h-[300px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[14px] text-slate-500">
        <Loader2 size={15} className="animate-spin text-cyan-600" />
        Interrogation d’OPM pour {pdbId.toUpperCase()}…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {opmOk && opm ? (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 rounded-md bg-cyan-600 p-2 text-white shadow-sm">
                <Waves size={16} />
              </span>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-cyan-700">
                  OPM · Orientations of Proteins in Membranes
                </p>
                <h2 className="text-[18px] font-semibold text-slate-900">
                  <span className="font-mono">{opm.opm_pdb_id}</span> · {opm.name}
                </h2>
                <p className="text-[14px] text-slate-500">
                  <span className="italic">{opm.species}</span>
                  {opm.resolution && <> · résolution {opm.resolution} Å</>}
                  {opm.membrane && <> · {opm.membrane}</>}
                </p>
              </div>
            </div>
            <a
              href={opm.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1.5 text-[14px] font-semibold text-white hover:bg-cyan-700"
            >
              Fiche OPM
              <ExternalLink size={13} />
            </a>
          </div>

          {!opm.is_representative && (
            <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
              {pdbId.toUpperCase()} est rattachée dans OPM à la structure représentative{" "}
              <span className="font-mono font-semibold">{opm.opm_pdb_id}</span> : l’orientation et
              les données ci-dessous concernent cette structure.
            </p>
          )}

          <div className="grid gap-4 p-4 xl:grid-cols-[1.35fr_1fr]">
            <div className="space-y-3">
              <dl className="grid gap-2 sm:grid-cols-3">
                <BigMetric
                  label="Épaisseur hydrophobe"
                  value={formatWithError(opm.hydrophobic_thickness, opm.thickness_error, "Å")}
                />
                <BigMetric
                  label="Angle d’inclinaison"
                  value={formatWithError(opm.tilt_angle, opm.tilt_error, "°")}
                />
                <BigMetric
                  label="ΔG de transfert"
                  value={
                    opm.delta_g_transfer != null
                      ? `${opm.delta_g_transfer.toLocaleString("fr-FR")} kcal/mol`
                      : "—"
                  }
                />
              </dl>

              <Membrane3DViewer
                opmPdbId={opm.opm_pdb_id}
                subunits={opm.subunits ?? []}
                outsideLabel={capitalize(opm.topology_out) || "Côté externe"}
                insideLabel={capitalize(opm.topology_in) || "Côté interne"}
                activeRange={activeRange}
              />

              <dl className="grid gap-2 sm:grid-cols-2">
                <Metric
                  label="Topologie (OPM)"
                  value={
                    opm.n_terminus
                      ? `N-terminal ${SIDE[opm.n_terminus]}${opm.reference_chain ? ` (chaîne ${opm.reference_chain})` : ""}`
                      : "—"
                  }
                />
                <Metric
                  label="Côtés de la membrane"
                  value={
                    opm.topology_out && opm.topology_in
                      ? `${capitalize(opm.topology_out)} / ${opm.topology_in}`
                      : "—"
                  }
                />
              </dl>
              <p className="text-[12px] leading-4 text-slate-400">
                Sphères rouges et bleues : limites du cœur hydrophobe calculées par OPM (faces
                externe et interne). Épaisseur et ΔG : méthode PPM (Lomize et al.).
              </p>
            </div>

            <div className="space-y-3">
              <Section title="Classification">
                <ol className="space-y-1 text-[14px]">
                  <ClassRow level="Type" value={opm.type} />
                  <ClassRow level="Classe" value={opm.class} />
                  <ClassRow level="Superfamille" value={opm.superfamily} links={[["Pfam", opm.superfamily_pfam, pfamUrl]]} />
                  <ClassRow
                    level="Famille"
                    value={opm.family}
                    links={[
                      ["Pfam", opm.family_pfam, pfamUrl],
                      ["InterPro", opm.family_interpro, (id) => `https://www.ebi.ac.uk/interpro/entry/InterPro/${id}/`],
                      ["TCDB", opm.family_tcdb, (id) => `https://www.tcdb.org/search/result.php?tc=${id}`],
                    ]}
                  />
                </ol>
              </Section>

              <Section title="Protéine">
                <dl className="space-y-1.5 text-[14px]">
                  <Row label="Espèce">
                    <span className="italic">{opm.species || "—"}</span>
                  </Row>
                  {opm.species_lineage && (
                    <p className="text-[12px] leading-4 text-slate-400" title={opm.species_lineage}>
                      {truncate(opm.species_lineage, 160)}
                    </p>
                  )}
                  <Row label="Membrane">{opm.membrane || "—"}</Row>
                  <Row label="UniProt">
                    {opm.uniprot_codes?.length ? (
                      <span className="flex flex-wrap justify-end gap-1">
                        {opm.uniprot_codes.map((code) => (
                          <a
                            key={code}
                            href={`https://www.uniprot.org/uniprotkb?query=id:${code}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                          >
                            {code}
                          </a>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Row>
                </dl>
              </Section>

              {(opm.subunits?.length ?? 0) > 0 && (
                <Section title={`Sous-unités transmembranaires (${opm.subunits!.length})`}>
                  {opm.subunits!.length > 1 && (
                    <p className="mb-2 text-[13px] leading-4 text-slate-600">
                      {opm.subunits!.reduce((n, su) => n + su.segments.length, 0)} segments au
                      total ({opm.subunits!.map((su) => su.segments.length).join(" + ")}). UniProt
                      compte les segments d’une seule chaîne.
                    </p>
                  )}
                  <div className="max-h-[220px] overflow-auto rounded border border-slate-100">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-2 py-1 text-left font-semibold">Chaîne</th>
                          <th className="px-2 py-1 text-right font-semibold">Inclinaison</th>
                          <th className="px-2 py-1 text-right font-semibold">Segments</th>
                          <th className="px-2 py-1 text-left font-semibold">Positions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opm.subunits!.map((su) => (
                          <tr key={su.chain} className="border-t border-slate-100 align-top">
                            <td className="px-2 py-1 font-mono font-semibold">{su.chain}</td>
                            <td className="px-2 py-1 text-right font-mono">{su.tilt != null ? `${su.tilt}°` : "—"}</td>
                            <td className="px-2 py-1 text-right font-mono">{su.segments.length}</td>
                            <td className="px-2 py-1 font-mono text-slate-600">
                              {su.segments.map((s) => `${s.start}–${s.end}`).join(", ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-400">Numérotation des résidus de {opm.opm_pdb_id}.</p>
                </Section>
              )}

              {(opm.comments || opm.verification) && (
                <Section title="Remarques des curateurs OPM">
                  {opm.comments && <p className="text-[14px] leading-5 text-slate-700">{opm.comments}</p>}
                  {opm.verification && (
                    <p className="mt-1 text-[14px] leading-5 text-slate-700">
                      <span className="font-semibold">Vérification : </span>
                      {opm.verification}
                    </p>
                  )}
                </Section>
              )}

              {(opm.citations?.length ?? 0) > 0 && (
                <Section title="Références" icon={<BookOpen size={13} />}>
                  <ul className="space-y-1.5 text-[13px] leading-4 text-slate-700">
                    {opm.citations!.map((c, i) => (
                      <li key={i}>
                        {c.text}{" "}
                        {c.pmid && (
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-blue-700 hover:underline"
                          >
                            PubMed {c.pmid}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {(opm.secondary_representations?.length ?? 0) > 0 && (
                <SecondaryList items={opm.secondary_representations!} />
              )}
            </div>
          </div>
        </section>
      ) : (
        <Notice>
          {opm?.message || "OPM indisponible."} L’orientation dans la bicouche ne peut pas être
          affichée pour {pdbId.toUpperCase()}.
          {opm?.url && (
            <>
              {" "}
              <a href={opm.url} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
                Rechercher dans OPM
              </a>
            </>
          )}
        </Notice>
      )}

      <UniProtTopology
        regions={regions}
        orientation={orientation}
        loading={loadingOrientation}
        activeRange={activeRange}
        onFocusRange={onFocusRange}
      />
    </div>
  );
}

function UniProtTopology({
  regions,
  orientation,
  loading,
  activeRange,
  onFocusRange,
}: {
  regions: Region[];
  orientation: OrientationResponse | null;
  loading: boolean;
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
}) {
  const o = orientation?.orientation;
  const segments = orientation?.tm_segments ?? [];
  const length = orientation?.sequence_length || 0;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
        <span className="rounded-md bg-amber-500 p-2 text-white shadow-sm">
          <Layers size={16} />
        </span>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-amber-700">UniProtKB</p>
          <h2 className="text-[17px] font-semibold text-slate-900">Topologie de la chaîne</h2>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 p-4 text-[14px] text-slate-500">
          <Loader2 size={14} className="animate-spin" />
          Chargement…
        </div>
      ) : !o ? (
        <p className="p-4 text-[14px] text-slate-500">Topologie indisponible.</p>
      ) : (
        <>
        {regions.some((r) => r.type === "transmembrane" || r.type === "intramembrane") && (
          <div className="border-b border-slate-100 p-4">
            <TopologyDiagram regions={regions} length={length} activeRange={activeRange} onSelect={onFocusRange} />
          </div>
        )}
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-2">
            <dl className="grid grid-cols-2 gap-2">
              <Metric label="Segments TM" value={`${o.tm_count}`} />
              <Metric label="Source" value={orientation?.method || "—"} />
              <Metric label="N-terminal" value={o.n_terminus ? SIDE[o.n_terminus] : "non annoté"} />
              <Metric label="C-terminal" value={o.c_terminus ? SIDE[o.c_terminus] : "non annoté"} />
            </dl>
            {o.interpretation && <p className="text-[14px] leading-5 text-slate-600">{o.interpretation}</p>}
          </div>
          <div>
            <div className="max-h-[220px] overflow-auto rounded-md border border-slate-200">
              {segments.length ? (
                <table className="w-full text-[14px]">
                  <tbody>
                    {segments.map((s, i) => {
                      const active = activeRange?.start === s.start && activeRange?.end === s.end;
                      return (
                        <tr key={`${s.start}-${s.end}`} className={`border-t border-slate-100 first:border-t-0 ${active ? "bg-amber-50" : ""}`}>
                          <td className="px-3 py-1.5 font-semibold text-amber-700">{s.label || `TM${i + 1}`}</td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {s.start}–{s.end}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-slate-500">{s.end - s.start + 1} aa</td>
                          <td className="px-3 py-1.5 text-right">
                            <button
                              onClick={() => onFocusRange({ start: s.start, end: s.end, label: s.label || `TM${i + 1}`, color: "#d97706" })}
                              className="rounded border border-amber-200 px-2 py-0.5 text-[13px] text-amber-800 hover:bg-amber-50"
                            >
                              3D
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="p-3 text-[14px] text-slate-500">Aucun segment transmembranaire.</p>
              )}
            </div>
            <p className="mt-1 text-[12px] text-slate-400">Numérotation UniProt (peut différer de celle du PDB).</p>
          </div>
        </div>
        </>
      )}
    </section>
  );
}

function SecondaryList({ items }: { items: { pdb_id: string; resolution: string | null }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 24);
  return (
    <Section title={`Autres structures de la même protéine dans OPM (${items.length})`}>
      <div className="flex flex-wrap gap-1">
        {shown.map((r) => (
          <a
            key={r.pdb_id}
            href={`https://www.rcsb.org/structure/${r.pdb_id}`}
            target="_blank"
            rel="noreferrer"
            title={r.resolution ? `Résolution ${r.resolution}` : undefined}
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-700 hover:bg-blue-50 hover:text-blue-700"
          >
            {r.pdb_id}
          </a>
        ))}
      </div>
      {items.length > 24 && (
        <button onClick={() => setAll((v) => !v)} className="mt-1.5 text-[13px] font-medium text-blue-700 hover:underline">
          {all ? "Réduire" : `Afficher les ${items.length}`}
        </button>
      )}
    </Section>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function ClassRow({
  level,
  value,
  links = [],
}: {
  level: string;
  value?: string | null;
  links?: [string, string | null | undefined, (id: string) => string][];
}) {
  return (
    <li className="flex items-start gap-2">
      <ChevronRight size={12} className="mt-1 shrink-0 text-slate-400" />
      <span className="w-[86px] shrink-0 text-slate-500">{level}</span>
      <span className="flex-1 font-medium text-slate-900">
        {value || "—"}
        {links
          .filter(([, id]) => id)
          .map(([label, id, url]) => (
            <a
              key={label}
              href={url(id!)}
              target="_blank"
              rel="noreferrer"
              className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] font-normal text-slate-600 hover:bg-blue-50 hover:text-blue-700"
            >
              {label} {id}
            </a>
          ))}
      </span>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function BigMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-cyan-100 bg-cyan-50 px-3 py-2">
      <dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-cyan-800">{label}</dt>
      <dd className="text-[20px] font-bold text-slate-900">{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</dt>
      <dd className="truncate text-[15px] font-semibold text-slate-900" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-white p-4 text-[14px] text-slate-600">{children}</p>
  );
}

function formatWithError(value?: number | null, error?: number | null, unit = "") {
  if (value == null) return "—";
  const v = value.toLocaleString("fr-FR");
  return error != null ? `${v} ± ${error.toLocaleString("fr-FR")} ${unit}` : `${v} ${unit}`;
}

function capitalize(text?: string) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function truncate(text: string, n: number) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

function pfamUrl(id: string) {
  return id.startsWith("CL")
    ? `https://www.ebi.ac.uk/interpro/set/pfam/${id}/`
    : `https://www.ebi.ac.uk/interpro/entry/pfam/${id}/`;
}
