"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Info, Loader2, Sparkles } from "lucide-react";
import { useModelAnalysis, type ModelAnalysis, type ModelMapping } from "@/lib/modelAnalysis";

// Couleurs AlphaFold DB du pLDDT
const PLDDT_COLORS = [
  { min: 90, color: "#0053d6", label: "> 90" },
  { min: 70, color: "#65cbf3", label: "70–90" },
  { min: 50, color: "#ffdb13", label: "50–70" },
  { min: -1, color: "#ff7d45", label: "< 50" },
];
const plddtColor = (v: number) => PLDDT_COLORS.find((b) => v >= b.min)!.color;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`);

export type FocusResidues = (positions: number[], label: string, color: string) => void;

function useAnalysis(accession: string): { data?: ModelAnalysis; node?: React.ReactNode } {
  const { data, error, loading } = useModelAnalysis(accession);
  if (loading)
    return {
      node: (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-[14px] text-slate-600">
          <Loader2 size={16} className="animate-spin text-blue-600" />
          Analyse du modèle AlphaFold (géométrie, contacts, poches)…
        </div>
      ),
    };
  if (error || !data?.available)
    return {
      node: (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-[14px] text-slate-600">
          Analyse du modèle AlphaFold impossible : {error ?? "modèle indisponible."}
        </div>
      ),
    };
  return { data };
}

/** Bandeau rappelant qu'il s'agit d'un modèle prédit, avec la correspondance des résidus. */
function ModelBanner({ data }: { data: ModelAnalysis }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
      <Sparkles size={16} />
      <span>
        <b>Modèle prédit</b> {data.model_id} (AlphaFold DB), aucune structure expérimentale analysée ici. pLDDT moyen{" "}
        {data.confidence.mean_plddt ?? "—"}.
      </span>
      <MappingBadge mapping={data.mapping} />
    </div>
  );
}

function MappingBadge({ mapping }: { mapping: ModelMapping }) {
  const ok = mapping.status === "exacte";
  return (
    <span
      title={mapping.text}
      className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-[13px] font-semibold ${ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}
    >
      {ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {ok ? "Résidus identiques à UniProt (même numérotation)" : "Correspondance UniProt à vérifier"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Onglet Site actif : sites annotés (confirmés ou non) et poches prédites
// ---------------------------------------------------------------------------

export function ModelSitesPanel({ accession, onFocus }: { accession: string; onFocus: FocusResidues }) {
  const { data, node } = useAnalysis(accession);
  const [selected, setSelected] = useState<string | null>(null);
  if (!data) return node;
  const confirmed = data.sites.filter((s) => s.confirmed);
  const annotated = data.sites.filter((s) => !s.confirmed);
  const pockets = data.pockets.pockets;

  const focus = (key: string, positions: number[], label: string, color: string) => {
    setSelected(key);
    onFocus(positions, label, color);
  };

  return (
    <div className="space-y-4">
      <ModelBanner data={data} />

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Trois niveaux de preuve, à ne pas confondre</h3>
        <div className="mt-2 grid gap-2 text-[13px] md:grid-cols-3">
          <Level icon={<FlaskConical size={15} />} tone="border-emerald-200 bg-emerald-50 text-emerald-900" title={`Sites confirmés expérimentalement (${confirmed.length})`}>
            Annotation UniProt appuyée par une expérience ou une structure expérimentale.
          </Level>
          <Level icon={<Info size={15} />} tone="border-sky-200 bg-sky-50 text-sky-900" title={`Sites annotés sans preuve expérimentale (${annotated.length})`}>
            Déduits par similarité ou par analyse de séquence : probables, non démontrés.
          </Level>
          <Level icon={<Sparkles size={15} />} tone="border-violet-200 bg-violet-50 text-violet-900" title={`Poches prédites (${pockets.length})`}>
            Cavités trouvées dans la géométrie du modèle : hypothèses, sans fonction démontrée.
          </Level>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-2.5 text-[16px] font-semibold text-slate-900">Sites annotés dans UniProt</h3>
        {data.sites.length === 0 ? (
          <p className="px-4 py-3 text-[14px] text-slate-600">Aucun site actif, site de liaison ni site particulier annoté pour cette protéine.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Statut</th>
                <th className="px-3 py-1.5 font-semibold">Type</th>
                <th className="px-3 py-1.5 font-semibold">Position</th>
                <th className="px-3 py-1.5 font-semibold">Description</th>
                <th className="px-3 py-1.5 font-semibold">Preuve</th>
                <th className="px-3 py-1.5 text-right font-semibold">pLDDT</th>
                <th className="px-3 py-1.5 font-semibold">Poche du modèle</th>
              </tr>
            </thead>
            <tbody>
              {data.sites.map((s, k) => {
                const key = `site-${k}`;
                return (
                  <tr
                    key={key}
                    onClick={() => focus(key, range(s.start, s.end), `${s.type} ${s.start}`, s.confirmed ? "#059669" : "#0284c7")}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selected === key ? "bg-violet-50" : ""}`}
                  >
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${s.confirmed ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-800"}`}>
                        {s.confirmed ? <FlaskConical size={12} /> : <Info size={12} />}
                        {s.confirmed ? "Confirmé" : "Non confirmé"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">{s.type}</td>
                    <td className="px-3 py-1.5 tabular-nums">{s.start === s.end ? s.start : `${s.start}–${s.end}`}</td>
                    <td className="max-w-[240px] truncate px-3 py-1.5" title={s.description}>
                      {s.description}
                    </td>
                    <td className="px-3 py-1.5">{s.evidence_label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.mean_plddt ?? "—"}</td>
                    <td className="px-3 py-1.5">{s.pockets.length ? s.pockets.map((p) => `P${p}`).join(", ") : "aucune"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <h3 className="text-[16px] font-semibold text-slate-900">Poches potentielles du modèle</h3>
          <p className="text-[13px] text-slate-500">
            {data.pockets.method}. Classées par taille, enfouissement et confiance du modèle. Cliquez une poche pour voir ses résidus en 3D.
          </p>
        </div>
        {pockets.length === 0 ? (
          <p className="px-4 py-3 text-[14px] text-slate-600">Aucune cavité enfouie assez grande n’a été trouvée dans le modèle.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pockets.map((p) => {
              const key = `pocket-${p.id}`;
              return (
                <li key={key}>
                  <button
                    onClick={() => focus(key, p.residues, `Poche prédite P${p.id}`, "#7c3aed")}
                    className={`w-full px-4 py-2.5 text-left text-[13px] hover:bg-slate-50 ${selected === key ? "bg-violet-50" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-800">P{p.id} · prédite</span>
                      <span className="text-slate-700">{p.status}</span>
                      {!p.reliable && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">
                          <AlertTriangle size={12} /> modèle peu fiable ici (pLDDT {p.mean_plddt ?? "—"})
                        </span>
                      )}
                      {p.in_membrane && <span className="rounded bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-800">dans la membrane : sillon lipidique possible</span>}
                    </div>
                    <p className="mt-1 text-slate-600">
                      {p.volume} Å³ de points de sonde · enfouissement {pct(p.burial)} · pLDDT moyen {p.mean_plddt ?? "—"} · hydrophobe {pct(p.hydrophobic_fraction)}, chargé{" "}
                      {pct(p.charged_fraction)} · {p.residues.length} résidus
                    </p>
                    <p className="mt-0.5 font-mono text-[12px] text-slate-500">{p.residue_labels.slice(0, 30).join(" ")}{p.residue_labels.length > 30 ? " …" : ""}</p>
                    {p.sites.length > 0 && (
                      <p className="mt-0.5 text-slate-700">
                        Sites UniProt dans la poche :{" "}
                        {p.sites.map((s) => `${s.type} ${s.position} (${s.description}, ${s.confirmed ? "confirmé" : "non confirmé"})`).join(" ; ")}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Limits limits={data.limits} />
    </div>
  );
}

function Level({ icon, tone, title, children }: { icon: React.ReactNode; tone: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`}>
      <p className="flex items-center gap-1.5 font-semibold">
        {icon}
        {title}
      </p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function Limits({ limits }: { limits: string[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-[15px] font-semibold text-slate-900">Limites de l’analyse d’un modèle</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-5 text-slate-700">
        {limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, k) => start + k);

// ---------------------------------------------------------------------------
// Onglet PDB / AlphaFold : correspondance, confiance, géométrie, contacts
// ---------------------------------------------------------------------------

export function ModelGeometryPanel({ accession, onFocus }: { accession: string; onFocus: FocusResidues }) {
  const { data, node } = useAnalysis(accession);
  if (!data) return node;
  const { mapping, confidence, geometry, contacts } = data;
  const rgRatio = geometry.radius_of_gyration && geometry.expected_globular_rg ? geometry.radius_of_gyration / geometry.expected_globular_rg : null;

  return (
    <div className="space-y-4">
      <ModelBanner data={data} />

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Correspondance séquence UniProt ↔ modèle</h3>
        <p className={`mt-1 text-[14px] ${mapping.status === "exacte" ? "text-emerald-800" : "text-rose-800"}`}>{mapping.text}</p>
        <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Résidus du modèle" value={`${mapping.model_residues} (${mapping.first}–${mapping.last})`} />
          <Fact label="Longueur UniProt" value={mapping.uniprot_length != null ? `${mapping.uniprot_length}` : "—"} />
          <Fact label="Acides aminés identiques" value={`${mapping.identical} / ${mapping.model_residues}`} />
          <Fact label="Version de la séquence" value={mapping.version_changed ? "différente de celle du modèle" : "identique à celle du modèle"} />
        </dl>
        {(mapping.mismatches.length > 0 || mapping.outside.length > 0) && (
          <p className="mt-2 text-[13px] text-rose-800">
            Différences :{" "}
            {mapping.mismatches.map((m) => `${m.position} (modèle ${m.model}, UniProt ${m.uniprot})`).join(", ")}
            {mapping.outside.length > 0 && ` · hors séquence : ${mapping.outside.join(", ")}`}
          </p>
        )}
        <p className="mt-2 text-[12px] text-slate-500">Vérifié contre : {mapping.checked_against}. Trous de numérotation dans le modèle : {mapping.numbering_gaps}.</p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Confiance du modèle (pLDDT)</h3>
        <PlddtProfile values={confidence.per_residue} onFocus={onFocus} />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600">
          {PLDDT_COLORS.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
              {b.label} : {pct(confidence.bands[b.min === 90 ? "very_high" : b.min === 70 ? "confident" : b.min === 50 ? "low" : "very_low"])}
            </span>
          ))}
        </div>
        {confidence.low_regions.length > 0 && (
          <p className="mt-2 text-[13px] text-slate-700">
            Régions peu fiables (pLDDT &lt; 70, souvent désordonnées) :{" "}
            {confidence.low_regions.map((r, k) => (
              <button key={k} onClick={() => onFocus(range(r.start, r.end), `pLDDT < 70 (${r.start}–${r.end})`, "#ff7d45")} className="mr-2 font-mono text-blue-700 hover:underline">
                {r.start}–{r.end}
              </button>
            ))}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Géométrie</h3>
        <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <Fact
            label="Ramachandran (résidus pLDDT ≥ 70)"
            value={`${geometry.ramachandran_confident.favored_percent ?? "—"} % favorables, ${geometry.ramachandran_confident.outliers_percent ?? "—"} % hors régions`}
          />
          <Fact label="Ramachandran (tous les résidus)" value={`${geometry.ramachandran.outliers_percent ?? "—"} % hors régions`} />
          <Fact label="Hélices / brins" value={`${pct(geometry.helix_fraction)} / ${pct(geometry.strand_fraction)}`} />
          <Fact
            label="Rayon de giration"
            value={geometry.radius_of_gyration != null ? `${geometry.radius_of_gyration} Å (≈ ${geometry.expected_globular_rg} Å si globulaire compacte)` : "—"}
          />
        </dl>
        <p className="mt-2 text-[13px] text-slate-600">
          Les angles φ/ψ hors régions sont comptés à part sur les résidus fiables : dans les régions de faible pLDDT, une géométrie
          irrégulière reflète surtout l’incertitude du modèle.
          {rgRatio != null && rgRatio > 1.3 && " Rayon de giration nettement supérieur à celui d’une protéine compacte : domaines séparés, régions étendues ou désordonnées."}
        </p>
        {geometry.outliers_confident.length > 0 && (
          <p className="mt-1 text-[13px] text-slate-700">
            Hors régions malgré un pLDDT ≥ 70 :{" "}
            {geometry.outliers_confident.slice(0, 20).map((o) => (
              <button key={o.resi} onClick={() => onFocus([o.resi], `${o.resn}${o.resi} hors régions`, "#dc2626")} className="mr-1.5 font-mono text-blue-700 hover:underline">
                {o.resn}
                {o.resi}
              </button>
            ))}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Contacts entre résidus</h3>
        <p className="text-[13px] text-slate-500">
          Cβ (Cα pour la glycine) à moins de {contacts.cutoff} Å, résidus séparés d’au moins {contacts.min_separation} positions. Couleur : pLDDT le plus faible des deux résidus.
        </p>
        <div className="mt-2 grid gap-4 lg:grid-cols-[380px_1fr]">
          <ContactMap analysis={data} onFocus={onFocus} />
          <dl className="grid content-start gap-2 text-[13px] sm:grid-cols-2">
            <Fact label="Contacts" value={`${contacts.total} (${contacts.per_residue} par résidu)`} />
            <Fact label="Entre résidus fiables (pLDDT ≥ 70)" value={`${contacts.confident} (${pct(contacts.total ? contacts.confident / contacts.total : null)})`} />
            <Fact label="Longue portée (≥ 24 positions)" value={`${contacts.long_range}`} />
            <Fact label="Ordre de contact relatif" value={contacts.relative_contact_order != null ? `${contacts.relative_contact_order}` : "—"} />
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Résidus les plus connectés</dt>
              <dd className="mt-0.5 flex flex-wrap gap-1.5">
                {contacts.most_connected.map((r) => (
                  <button key={r.resi} onClick={() => onFocus([r.resi], `Résidu ${r.resi}`, "#7c3aed")} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono hover:bg-slate-200">
                    {r.resi} <span className="font-sans text-slate-500">({r.contacts})</span>
                  </button>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <Limits limits={data.limits} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function PlddtProfile({ values, onFocus }: { values: [number, number][]; onFocus: FocusResidues }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const W = 1000;
  const H = 110;
  const L = 30;
  const n = values.length;
  const bar = (W - L - 8) / Math.max(n, 1);
  const y = (v: number) => 8 + (1 - v / 100) * (H - 24);
  const pick = (clientX: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const k = Math.floor((((clientX - rect.left) / rect.width) * W - L) / bar);
    return k >= 0 && k < n ? values[k] : null;
  };
  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full cursor-crosshair"
        role="img"
        aria-label="pLDDT par résidu"
        onMouseMove={(e) => setHover(pick(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const v = pick(e.clientX);
          if (v) onFocus([v[0]], `Résidu ${v[0]}`, "#7c3aed");
        }}
      >
        {[50, 70, 90].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray="3 3" />
            <text x={L - 4} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#64748b">
              {t}
            </text>
          </g>
        ))}
        {values.map(([resi, v], k) => (
          <rect key={resi} x={L + k * bar} y={y(v)} width={Math.max(bar - (bar > 3 ? 0.4 : 0), 0.6)} height={H - 16 - y(v)} fill={plddtColor(v)} />
        ))}
        <line x1={L} x2={W - 8} y1={H - 16} y2={H - 16} stroke="#94a3b8" />
        <text x={L} y={H - 3} fontSize={10} fill="#64748b">
          {values[0]?.[0]}
        </text>
        <text x={W - 8} y={H - 3} fontSize={10} fill="#64748b" textAnchor="end">
          {values[n - 1]?.[0]}
        </text>
      </svg>
      <p className="min-h-[20px] text-[13px] text-slate-600">{hover ? `Résidu ${hover[0]} · pLDDT ${hover[1]}` : "Survolez le profil ; cliquez pour voir le résidu en 3D."}</p>
    </div>
  );
}

/** Carte de contacts (dessinée sur un canevas : plusieurs milliers de paires). */
function ContactMap({ analysis, onFocus }: { analysis: ModelAnalysis; onFocus: FocusResidues }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const SIZE = 360;
  const first = analysis.mapping.first ?? 1;
  const last = analysis.mapping.last ?? analysis.mapping.model_residues;
  const span = Math.max(last - first + 1, 1);
  const scale = SIZE / span;
  const lookup = useMemo(() => new Map(analysis.contacts.pairs.map(([i, j, p]) => [`${i}-${j}`, p])), [analysis]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = SIZE * ratio;
    canvas.height = SIZE * ratio;
    const context = canvas.getContext("2d")!;
    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, SIZE, SIZE);
    context.strokeStyle = "#e2e8f0";
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(SIZE, SIZE);
    context.stroke();
    const dot = Math.max(scale, 1.2);
    for (const [i, j, p] of analysis.contacts.pairs) {
      context.fillStyle = plddtColor(p);
      context.fillRect((i - first) * scale, (j - first) * scale, dot, dot);
      context.fillRect((j - first) * scale, (i - first) * scale, dot, dot);
    }
  }, [analysis, first, scale]);

  const at = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const a = Math.floor(((e.clientX - rect.left) / rect.width) * span) + first;
    const b = Math.floor(((e.clientY - rect.top) / rect.height) * span) + first;
    const [i, j] = a < b ? [a, b] : [b, a];
    // Contact le plus proche dans un voisinage de 2 positions
    for (let d = 0; d <= 2; d++)
      for (let di = -d; di <= d; di++)
        for (let dj = -d; dj <= d; dj++) {
          const p = lookup.get(`${i + di}-${j + dj}`);
          if (p !== undefined) return { i: i + di, j: j + dj, p };
        }
    return null;
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: SIZE, height: SIZE }}
        className="max-w-full cursor-crosshair rounded border border-slate-200"
        role="img"
        aria-label="Carte de contacts entre résidus"
        onMouseMove={(e) => {
          const c = at(e);
          setHover(c ? `Contact ${c.i} – ${c.j} · pLDDT minimal ${c.p}` : null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const c = at(e);
          if (c) onFocus([c.i, c.j], `Contact ${c.i}–${c.j}`, "#7c3aed");
        }}
      />
      <p className="mt-1 min-h-[20px] text-[12px] text-slate-600">{hover ?? `Résidus ${first} à ${last} sur les deux axes ; cliquez un point pour voir la paire en 3D.`}</p>
    </div>
  );
}
