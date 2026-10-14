"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { ZONES, type ExplorerResult, type Zone } from "@/lib/explorer";
import RerunNotice from "./RerunNotice";
import { LegendItem, type ResidueMark } from "./ExplorerViewer";
import { sectorColor } from "./ScaView";

const ExplorerViewer = dynamic(() => import("./ExplorerViewer"), { ssr: false });

const BOTH = "#dc2626";
const MIP_ONLY = "#2563eb";
const SCA_ONLY = "#9333ea";
const ZONE_ORDER: Zone[] = ["out", "interface_out", "core", "membrane", "interface_in", "in", "loop"];

/** Comparaison des résidus désignés par la MIp (paires fortes) et par la SCA (secteurs). */
export default function ComparisonView({
  result,
  selected,
  onSelect,
  onRerun,
}: {
  result: ExplorerResult;
  selected: number | null;
  onSelect: (position: number) => void;
  onRerun?: () => Promise<void>;
}) {
  const comparison = result.comparison;

  const { colors, marks } = useMemo(() => {
    const map = new Map<number, string>();
    const list: ResidueMark[] = [];
    for (const p of result.positions) {
      const mip = p.couplings > 0;
      const sca = !!p.sector;
      if (!mip && !sca) continue;
      const color = mip && sca ? BOTH : mip ? MIP_ONLY : SCA_ONLY;
      map.set(p.position, color);
      if (mip && sca) list.push({ position: p.position, color: BOTH, label: `${p.residue}${p.position}` });
    }
    return { colors: map, marks: list };
  }, [result.positions]);

  if (!comparison) {
    return (
      <RerunNotice
        title="Cette analyse a été lancée avant l’ajout de la SCA."
        text="Recalculez-la avec les mêmes séquences et les mêmes réglages pour obtenir les secteurs SCA et la comparaison avec la MIp."
        button="Recalculer avec la SCA"
        onRerun={onRerun}
      />
    );
  }

  const total = comparison.mip_only + comparison.sca_only + comparison.shared.length;
  const pct = (n: number) => (total ? (100 * n) / total : 0);
  const reliability = result.coevolution?.reliability.level;

  return (
    <div className="space-y-4">
      {(reliability === "insuffisante" || reliability === "faible") && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
          Alignement peu profond (fiabilité {reliability}) : la MIp comme la SCA sont alors bruitées et leur accord peut
          être fortuit. Relancez l’analyse avec la recherche étendue.
        </p>
      )}

      <section className="card p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Recouvrement des deux méthodes</h3>
        <p className="mb-3 text-[13px] text-slate-500">
          MIp : résidus engagés dans au moins une paire forte (z ≥ 3). SCA : résidus membres d’un secteur.
        </p>
        <div className="flex h-9 overflow-hidden rounded-lg text-[13px] font-semibold text-white">
          {comparison.mip_only > 0 && (
            <div className="flex items-center justify-center" style={{ width: `${pct(comparison.mip_only)}%`, backgroundColor: MIP_ONLY }}>
              {comparison.mip_only}
            </div>
          )}
          {comparison.shared.length > 0 && (
            <div className="flex items-center justify-center" style={{ width: `${pct(comparison.shared.length)}%`, backgroundColor: BOTH }}>
              {comparison.shared.length}
            </div>
          )}
          {comparison.sca_only > 0 && (
            <div className="flex items-center justify-center" style={{ width: `${pct(comparison.sca_only)}%`, backgroundColor: SCA_ONLY }}>
              {comparison.sca_only}
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-600">
          <LegendItem color={MIP_ONLY} label={`MIp seule (${comparison.mip_only})`} />
          <LegendItem color={BOTH} label={`Les deux méthodes (${comparison.shared.length})`} />
          <LegendItem color={SCA_ONLY} label={`SCA seule (${comparison.sca_only})`} />
        </div>
        <dl className="mt-3 grid gap-2 text-[14px] sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Indice de Jaccard" value={comparison.jaccard != null ? comparison.jaccard.toLocaleString("fr-FR") : "—"} hint="part commune des deux ensembles (0 à 1)" />
          <Fact
            label="Paires MIp dans un même secteur"
            value={`${comparison.pairs_within_sector} / ${comparison.strong_pairs}`}
            hint="les deux résidus de la paire sont dans le même secteur"
          />
          <Fact label="Grade moyen MIp" value={comparison.mip_mean_grade != null ? `${comparison.mip_mean_grade}/9` : "—"} hint="conservation des résidus couplés" />
          <Fact label="Grade moyen SCA" value={comparison.sca_mean_grade != null ? `${comparison.sca_mean_grade}/9` : "—"} hint="la SCA privilégie les positions conservées" />
        </dl>
      </section>

      <div className={`grid gap-4 ${result.structure ? "xl:grid-cols-[1.2fr_1fr]" : ""}`}>
        {result.structure && (
          <section className="card p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">Les deux méthodes sur la structure dans la membrane</h3>
            <p className="mb-2 text-[13px] text-slate-500">En bâtonnets : les résidus désignés par les deux méthodes.</p>
            <ExplorerViewer
              pdb={result.structure.pdb}
              colors={colors}
              marks={marks}
              focus={selected}
              height={500}
              legend={
                <>
                  <LegendItem color={BOTH} label="MIp et SCA" />
                  <LegendItem color={MIP_ONLY} label="MIp seule" />
                  <LegendItem color={SCA_ONLY} label="SCA seule" />
                </>
              }
            />
          </section>
        )}

        <div className="space-y-4">
          <section className="card p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">Résidus désignés par les deux méthodes</h3>
            <p className="mb-2 text-[13px] text-slate-500">Les candidats les plus solides : deux approches indépendantes les retiennent.</p>
            <div className="flex flex-wrap gap-1.5">
              {comparison.shared.map((r) => (
                <button
                  key={r.position}
                  onClick={() => onSelect(r.position)}
                  title={`Secteur SCA ${r.sector}`}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[13px] font-semibold text-white ${selected === r.position ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                  style={{ backgroundColor: BOTH }}
                >
                  {r.residue}
                  {r.position}
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sectorColor(r.sector) }} />
                </button>
              ))}
              {comparison.shared.length === 0 && <p className="text-[14px] text-slate-500">Aucun résidu commun.</p>}
            </div>
          </section>

          <section className="card p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">Position dans la membrane</h3>
            <table className="mt-2 w-full text-[13px]">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 font-semibold">Zone</th>
                  <th className="py-1 text-right font-semibold" style={{ color: MIP_ONLY }}>MIp seule</th>
                  <th className="py-1 text-right font-semibold" style={{ color: BOTH }}>Les deux</th>
                  <th className="py-1 text-right font-semibold" style={{ color: SCA_ONLY }}>SCA seule</th>
                </tr>
              </thead>
              <tbody>
                {ZONE_ORDER.filter((z) => comparison.zones[z]).map((z) => (
                  <tr key={z} className="border-t border-slate-100">
                    <td className="py-1.5">{ZONES[z].label}</td>
                    <td className="py-1.5 text-right tabular-nums">{comparison.zones[z]!.mip}</td>
                    <td className="py-1.5 text-right tabular-nums">{comparison.zones[z]!.both}</td>
                    <td className="py-1.5 text-right tabular-nums">{comparison.zones[z]!.sca}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">Chaque secteur vu par la MIp</h3>
            <ul className="mt-2 space-y-1.5 text-[13px]">
              {comparison.per_sector.map((s) => (
                <li key={s.id} className="grid grid-cols-[90px_1fr_70px] items-center gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sectorColor(s.id) }} />
                    Secteur {s.id}
                  </span>
                  <span className="h-3 rounded-sm bg-slate-100">
                    <span className="block h-3 rounded-sm" style={{ width: `${(100 * s.shared) / s.size}%`, backgroundColor: BOTH }} />
                  </span>
                  <span className="text-right tabular-nums text-slate-600">
                    {s.shared}/{s.size}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-slate-500">Part des positions de chaque secteur également couplées par la MIp.</p>
          </section>
        </div>
      </div>

      <section className="card p-4 text-[14px] leading-6 text-slate-600">
        <h3 className="mb-1 text-[16px] font-semibold text-slate-900">Pourquoi les deux méthodes diffèrent</h3>
        <p>
          La <b>MIp</b> mesure la dépendance entre deux positions, quelle que soit leur conservation : elle repère surtout
          des contacts directs (empilement d’hélices, ponts salins) et des paires variables. La <b>SCA</b> pondère les
          corrélations par la conservation et cherche des groupes entiers qui varient ensemble : elle repère plutôt des
          réseaux conservés liés à la fonction. Leur accord n’est donc pas attendu partout ; les résidus retenus par les
          deux sont les meilleures hypothèses à tester, ceux d’une seule méthode éclairent soit la structure (MIp), soit la
          fonction (SCA).
        </p>
      </section>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</dt>
      <dd className="text-[20px] font-bold text-slate-900">{value}</dd>
      <dd className="text-[12px] text-slate-500">{hint}</dd>
    </div>
  );
}
