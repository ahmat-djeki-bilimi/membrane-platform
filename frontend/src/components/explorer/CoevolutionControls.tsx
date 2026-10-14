"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { CheckStatus, Coevolution, CoevolutionDiagnostics, Histogram, Sca } from "@/lib/explorer";

const pct = (v?: number | null) => (v == null ? "—" : `${Math.round(v * 100)} %`);

const STATUS: Record<CheckStatus, { label: string; className: string; icon: React.ReactNode }> = {
  ok: { label: "Correct", className: "bg-emerald-50 text-emerald-800", icon: <CheckCircle2 size={14} /> },
  attention: { label: "Attention", className: "bg-amber-50 text-amber-800", icon: <AlertTriangle size={14} /> },
  probleme: { label: "Problème", className: "bg-rose-50 text-rose-800", icon: <XCircle size={14} /> },
};

function Badge({ status }: { status: CheckStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ${s.className}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="text-[16px] font-semibold text-slate-900">{title}</h3>
      {subtitle && <p className="mb-2 text-[13px] text-slate-500">{subtitle}</p>}
      {children}
    </section>
  );
}

function Params({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[220px_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500">{label}</dt>
          <dd className="text-slate-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Contrôles communs à la MIp et à la SCA : profondeur, redondance, gaps, biais phylogénétique. */
export function AlignmentChecks({ diagnostics }: { diagnostics?: CoevolutionDiagnostics }) {
  if (!diagnostics) return null;
  return (
    <Panel
      title="Contrôles de l’alignement avant coévolution"
      subtitle="Ils valent pour la MIp comme pour la SCA : un signal de coévolution n’est interprétable que si ces conditions sont réunies."
    >
      <ul className="grid gap-2 md:grid-cols-2">
        {diagnostics.checks.map((c) => (
          <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-[13px]">
            <p className="flex flex-wrap items-center gap-2">
              <b className="text-slate-900">{c.label}</b>
              <Badge status={c.status} />
            </p>
            <p className="mt-0.5 font-semibold text-slate-800">{c.value}</p>
            <p className="mt-0.5 leading-5 text-slate-600">{c.text}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// MIp
// ---------------------------------------------------------------------------

export function MipControls({ coevolution }: { coevolution: Coevolution }) {
  const p = coevolution.parameters;
  const distribution = coevolution.distribution;
  const robustness = coevolution.robustness;
  const benchmark = coevolution.benchmark;
  const topCount = Math.max(1, Math.floor(coevolution.length / 5));
  const cutoff = coevolution.pairs[topCount - 1]?.z ?? null;
  if (!p) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Paramètres et seuils de la MIp">
          <Params
            items={[
              ["Pondération des séquences", `1 / nombre de séquences à ≥ ${pct(p.identity_threshold)} d’identité`],
              ["Pseudo-fréquence", `${p.pseudocount} (${p.states} états : 20 acides aminés + gap)`],
              ["Colonnes exclues", `plus de ${pct(p.max_gap_fraction)} de gaps${p.masked_columns ? `, ${p.masked_columns} masquées par le contrôle qualité` : ""}`],
              ["Séparation minimale", `${p.min_separation} positions dans la séquence`],
              ["Correction", "APC (Dunn et al., 2008) : retire le signal commun à chaque colonne (entropie, phylogénie)"],
              ["Paires retenues", `les L/5 premières (${topCount}), triées par score`],
              ["Paires fortes (réseaux)", "z ≥ 3 parmi les L/5 premières et au-dessus du seuil des alignements mélangés"],
            ]}
          />
        </Panel>
        {distribution && distribution.counts.length > 0 && (
          <Panel
            title="Distribution des scores"
            subtitle={`${distribution.pairs.toLocaleString("fr-FR")} paires évaluées · ${distribution.above_z3} à z ≥ 3, ${distribution.above_z5} à z ≥ 5. Un signal réel forme une queue nette à droite.`}
          >
            <HistogramChart
              histogram={distribution}
              label="z (écart à la moyenne, en écarts-types)"
              marks={[
                { value: 3, label: "z = 3", color: "#e11d48" },
                ...(cutoff != null ? [{ value: cutoff, label: `${topCount}e paire`, color: "#7c3aed" }] : []),
              ]}
            />
          </Panel>
        )}
      </div>

      {robustness && (
        <Panel
          title="Tests de robustesse"
          subtitle={robustness.note ?? `Les L/5 premières paires (${robustness.top_count}) sont-elles retrouvées avec moins de séquences, et dépassent-elles le hasard ?`}
        >
          {!robustness.skipped && (
            <div className="grid gap-3 text-[13px] md:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">Sous-échantillonnage ({robustness.subsamples} × {pct(robustness.fraction)} des séquences)</p>
                <p className="mt-1 text-slate-700">
                  En moyenne <b>{pct(robustness.mean_overlap)}</b> des paires retrouvées parmi les L/5 premières (répétitions :{" "}
                  {robustness.overlaps.map((o) => pct(o)).join(", ")}). <b>{robustness.stable_pairs}</b> paire(s) retrouvée(s) dans au moins
                  75 % des répétitions.
                </p>
                <p className="mt-1 text-slate-500">Une paire instable dépend de quelques séquences : à ne pas surinterpréter.</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">Hypothèse nulle ({robustness.shuffles} alignement(s) mélangé(s))</p>
                <p className="mt-1 text-slate-700">
                  Chaque colonne est mélangée entre les séquences : la conservation est gardée, la covariation détruite. Meilleur score
                  obtenu : <b>{robustness.null_max_score}</b>. <b>{robustness.above_null}</b> des {robustness.top_count} premières paires le
                  dépassent.
                </p>
                <p className="mt-1 text-slate-500">Les autres ne se distinguent pas de ce qu’on obtient sans aucune coévolution.</p>
              </div>
            </div>
          )}
        </Panel>
      )}

      <Panel title="Paires prédites et contacts structuraux" subtitle={benchmark?.structure_note ?? "Aucune structure 3D : la comparaison aux contacts est impossible."}>
        {benchmark && (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <PrecisionCurve curve={benchmark.curve} random={coevolution.random_precision ?? null} />
            <div className="space-y-2 text-[13px]">
              <p>
                Précision des L/5 premières paires : <b>{pct(benchmark.top_precision)}</b>
                {benchmark.enrichment != null && (
                  <>
                    , soit <b>{benchmark.enrichment}×</b> le hasard ({pct(coevolution.random_precision)})
                  </>
                )}
                .
              </p>
              <p>
                Sur les seuls résidus fiables du modèle (pLDDT ≥ 70) : <b>{pct(benchmark.confident_precision)}</b> ({benchmark.confident_count} paires).
              </p>
              {benchmark.by_separation.length > 0 && (
                <table className="w-full">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 font-semibold">Séparation dans la séquence</th>
                      <th className="py-1 text-right font-semibold">Paires</th>
                      <th className="py-1 text-right font-semibold">Précision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmark.by_separation.map((c) => (
                      <tr key={c.label} className="border-t border-slate-100">
                        <td className="py-1">{c.label}</td>
                        <td className="py-1 text-right tabular-nums">{c.count}</td>
                        <td className="py-1 text-right tabular-nums">{pct(c.precision)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-slate-500">
                Les contacts à longue portée sont les plus informatifs : les paires proches dans la séquence sont souvent en contact
                quelle que soit la coévolution. Une paire hors contact n’est pas forcément fausse (changement de conformation,
                dimère, contact indirect).
              </p>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCA
// ---------------------------------------------------------------------------

export function ScaControls({ sca }: { sca: Sca }) {
  const p = sca.parameters;
  if (!p) return null;
  const test = sca.stability_test;
  const r = sca.first_mode_conservation_r;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Paramètres et seuils de la SCA">
          <Params
            items={[
              ["Pondération des séquences", `identité ≥ ${pct(p.identity_threshold)}`],
              ["Pseudo-fréquence", `${p.pseudocount}`],
              ["Colonnes exclues", `plus de ${pct(p.max_gap_fraction)} de gaps${p.masked_columns ? `, ${p.masked_columns} masquées` : ""}`],
              ["Modes significatifs", `valeur propre > moyenne + 3 écarts-types de la 2e valeur propre de ${p.random_trials} alignements aléatoires`],
              ["Composantes indépendantes", `au plus ${p.max_components} (ICA)`],
              ["Appartenance à un secteur", `score robuste ≥ ${p.sector_z} (médiane, MAD), un seul secteur par position`],
              ["Taille minimale", `${p.min_sector_size} positions`],
            ]}
          />
        </Panel>
        <Panel title="Conservation globale ou covariance collective ?">
          <p className="text-[13px] leading-5 text-slate-700">
            La SCA pondère chaque corrélation par la conservation : un groupe de positions très conservées peut ressortir sans
            covarier. Corrélation entre le premier mode et la conservation : <b>{r ?? "—"}</b>
            {r != null && r >= 0.6 ? " — comme attendu, il reflète surtout la conservation globale et n’est pas un secteur." : "."}
          </p>
          <p className="mt-2 text-[13px] leading-5 text-slate-700">
            Pour chaque secteur, le couplage moyen entre ses membres est comparé à celui de groupes tirés au hasard parmi des positions
            de conservation semblable (z de covariance). Un z ≥ 2 indique une <b>covariance collective</b> au-delà de la conservation ;
            un z faible, ou des contributions très corrélées à la conservation, un secteur <b>dominé par la conservation</b>.
          </p>
        </Panel>
      </div>

      <Panel
        title="Fiabilité des secteurs"
        subtitle={test?.note ?? (test ? `Stabilité : secteurs recalculés sur ${test.subsamples} sous-échantillons de ${pct(test.fraction)} des séquences (même nombre de composantes) ; meilleur recouvrement (indice de Jaccard).` : undefined)}
      >
        <table className="w-full text-[13px]">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 font-semibold">Secteur</th>
              <th className="py-1 text-right font-semibold">Positions</th>
              <th className="py-1 text-right font-semibold" title="Part des positions analysées moins conservées que la moyenne du secteur">
                Rang de conservation
              </th>
              <th className="py-1 text-right font-semibold" title="Corrélation (Spearman) entre les contributions au secteur et la conservation">
                r conservation
              </th>
              <th className="py-1 text-right font-semibold">z covariance</th>
              <th className="py-1 font-semibold">Signal</th>
              <th className="py-1 font-semibold">Stabilité</th>
            </tr>
          </thead>
          <tbody>
            {sca.sectors.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-1 font-semibold">Secteur {s.id}</td>
                <td className="py-1 text-right tabular-nums">{s.size}</td>
                <td className="py-1 text-right tabular-nums">{pct(s.conservation_percentile)}</td>
                <td className="py-1 text-right tabular-nums">{s.loading_conservation_r ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">{s.covariance_z ?? "—"}</td>
                <td className="py-1">{s.signal ? <SignalBadge signal={s.signal} /> : "—"}</td>
                <td className="py-1">{s.stability_label ? `${s.stability_label} (${s.stability})` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {test && test.sector_counts.length > 0 && (
          <p className="mt-2 text-[12px] text-slate-500">Nombre de secteurs obtenus dans les sous-échantillons : {test.sector_counts.join(", ")}.</p>
        )}
      </Panel>

      {sca.loading_histograms && sca.loading_histograms.length > 0 && (
        <Panel title="Distribution des contributions par composante" subtitle={`Score robuste de chaque position ; les positions au-delà de ${p.sector_z} forment le secteur.`}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {sca.loading_histograms.map((h, k) => (
              <div key={k}>
                <p className="text-[12px] font-semibold text-slate-600">Composante {k + 1}</p>
                <HistogramChart histogram={h} compact marks={[{ value: p.sector_z, label: `${p.sector_z}`, color: "#e11d48" }]} />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

export function SignalBadge({ signal }: { signal: NonNullable<Sca["sectors"][number]["signal"]> }) {
  const tone =
    signal === "covariance collective" ? "bg-emerald-50 text-emerald-800" : signal === "dominé par la conservation" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700";
  return <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${tone}`}>{signal}</span>;
}

// ---------------------------------------------------------------------------
// Graphiques
// ---------------------------------------------------------------------------

function HistogramChart({
  histogram,
  marks = [],
  label,
  compact = false,
}: {
  histogram: Histogram;
  marks?: { value: number; label: string; color: string }[];
  label?: string;
  compact?: boolean;
}) {
  const W = compact ? 260 : 520;
  const H = compact ? 90 : 160;
  const L = 8;
  const B = label ? 30 : 16;
  const { edges, counts } = histogram;
  const lo = edges[0];
  const hi = edges[edges.length - 1];
  const x = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (W - 2 * L);
  // Échelle racine carrée : la queue de quelques paires reste visible à côté de milliers de paires
  const max = Math.sqrt(Math.max(...counts, 1));
  const y = (c: number) => H - B - (Math.sqrt(c) / max) * (H - B - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Histogramme des scores">
      {counts.map((c, k) => (
        <rect key={k} x={x(edges[k]) + 0.5} y={y(c)} width={Math.max(x(edges[k + 1]) - x(edges[k]) - 1, 0.5)} height={H - B - y(c)} fill="#64748b">
          <title>{`${edges[k]} à ${edges[k + 1]} : ${c}`}</title>
        </rect>
      ))}
      <line x1={L} x2={W - L} y1={H - B} y2={H - B} stroke="#94a3b8" />
      {marks
        .filter((m) => m.value >= lo && m.value <= hi)
        .map((m) => (
          <g key={m.label}>
            <line x1={x(m.value)} x2={x(m.value)} y1={6} y2={H - B} stroke={m.color} strokeDasharray="4 3" />
            <text x={x(m.value) + 3} y={14} fontSize={10} fill={m.color}>
              {m.label}
            </text>
          </g>
        ))}
      <text x={L} y={H - B + 12} fontSize={10} fill="#64748b">
        {lo}
      </text>
      <text x={W - L} y={H - B + 12} fontSize={10} fill="#64748b" textAnchor="end">
        {hi}
      </text>
      {label && (
        <text x={W / 2} y={H - 4} fontSize={10} fill="#64748b" textAnchor="middle">
          {label} · hauteur en racine carrée des effectifs
        </text>
      )}
    </svg>
  );
}

function PrecisionCurve({ curve, random }: { curve: [number, number][]; random: number | null }) {
  const W = 520;
  const H = 180;
  const L = 34;
  const B = 28;
  const maxRank = curve[curve.length - 1]?.[0] ?? 1;
  const x = (rank: number) => L + ((rank - 1) / Math.max(maxRank - 1, 1)) * (W - L - 10);
  const y = (v: number) => 8 + (1 - v) * (H - B - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Précision des paires selon leur rang">
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 10} y1={y(v)} y2={y(v)} stroke="#eef2f6" />
          <text x={L - 4} y={y(v) + 4} fontSize={10} fill="#64748b" textAnchor="end">
            {v * 100}
          </text>
        </g>
      ))}
      {random != null && (
        <g>
          <line x1={L} x2={W - 10} y1={y(random)} y2={y(random)} stroke="#94a3b8" strokeDasharray="4 3" />
          <text x={W - 12} y={y(random) - 4} fontSize={10} fill="#64748b" textAnchor="end">
            hasard
          </text>
        </g>
      )}
      <polyline points={curve.map(([r, v]) => `${x(r)},${y(v)}`).join(" ")} fill="none" stroke="#059669" strokeWidth={2} />
      {curve.map(([r, v]) => (
        <circle key={r} cx={x(r)} cy={y(v)} r={4} fill="transparent">
          <title>{`${r} premières paires : ${Math.round(v * 100)} % en contact`}</title>
        </circle>
      ))}
      <text x={L} y={H - 8} fontSize={10} fill="#64748b">
        1
      </text>
      <text x={W - 10} y={H - 8} fontSize={10} fill="#64748b" textAnchor="end">
        {maxRank}
      </text>
      <text x={(W + L) / 2} y={H - 8} fontSize={10} fill="#64748b" textAnchor="middle">
        rang de la paire · précision en % (paires en contact parmi les premières)
      </text>
    </svg>
  );
}
