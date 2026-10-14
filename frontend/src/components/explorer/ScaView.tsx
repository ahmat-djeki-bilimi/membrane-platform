"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Boxes, Layers, Sigma, Target } from "lucide-react";
import { StatCard } from "@/components/ui";
import { SECTOR_COLORS, ZONES, type ExplorerResult, type Sector, type Zone } from "@/lib/explorer";
import RerunNotice from "./RerunNotice";
import { ScaControls, SignalBadge } from "./CoevolutionControls";
import { LegendItem, type ResidueMark } from "./ExplorerViewer";

const ExplorerViewer = dynamic(() => import("./ExplorerViewer"), { ssr: false });

export const sectorColor = (id: number) => SECTOR_COLORS[(id - 1) % SECTOR_COLORS.length];

/** Statistical Coupling Analysis : secteurs de résidus qui coévoluent ensemble. */
export default function ScaView({
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
  const sca = result.sca;
  const [active, setActive] = useState<number | null>(null);
  const sectors = useMemo(() => sca?.sectors ?? [], [sca]);
  const shown = active === null ? sectors : sectors.filter((s) => s.id === active);

  const colors = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of shown) for (const p of s.positions) map.set(p, sectorColor(s.id));
    return map;
  }, [shown]);

  const marks: ResidueMark[] = useMemo(
    () =>
      shown.flatMap((s) =>
        [...s.residues]
          .sort((a, b) => b.weight - a.weight)
          .map((r, k) => ({
            position: r.position,
            color: sectorColor(s.id),
            // Étiquettes : les 6 positions les plus marquées de chaque secteur affiché
            label: k < (active === null ? 3 : 8) ? `${r.residue}${r.position}` : undefined,
          }))
      ),
    [shown, active]
  );

  if (!sca) {
    return (
      <RerunNotice
        title="Cette analyse a été lancée avant l’ajout de la SCA."
        text="Recalculez-la avec les mêmes séquences et les mêmes réglages pour obtenir les secteurs SCA et la comparaison avec la MIp."
        button="Recalculer avec la SCA"
        onRerun={onRerun}
      />
    );
  }

  const first = sectors[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="violet" icon={<Sigma size={15} />} label="Modes significatifs" value={`${sca.significant_modes}`} hint={`valeurs propres au-dessus du hasard (seuil ${sca.random_threshold}) ; le 1er reflète surtout la conservation`} />
        <StatCard tone="rose" icon={<Boxes size={15} />} label="Secteurs" value={`${sectors.length}`} hint={`${sectors.reduce((n, s) => n + s.size, 0)} positions au total`} />
        <StatCard
          tone="amber"
          icon={<Layers size={15} />}
          label="Secteur 1"
          value={first ? `${first.size} positions` : "—"}
          hint={first ? (first.helices.length ? first.helices.join(", ") : "hors hélices") : "aucun secteur"}
        />
        <StatCard
          tone="emerald"
          icon={<Target size={15} />}
          label="Compacité du secteur 1"
          value={first?.compactness != null ? `${first.compactness}` : "—"}
          hint="< 1 : résidus regroupés en 3D"
        />
      </div>

      <div className={`grid gap-4 ${result.structure ? "xl:grid-cols-[1.2fr_1fr]" : ""}`}>
        {result.structure && (
          <section className="card p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">Secteurs SCA sur la structure dans la membrane</h3>
            <p className="mb-2 text-[13px] text-slate-500">
              {active === null ? "Tous les secteurs ; cliquez un secteur à droite pour l’isoler." : `Secteur ${active} isolé.`}
            </p>
            <ExplorerViewer
              pdb={result.structure.pdb}
              colors={colors}
              marks={marks}
              focus={selected}
              height={500}
              legend={shown.map((s) => (
                <LegendItem key={s.id} color={sectorColor(s.id)} label={`Secteur ${s.id} (${s.size})`} />
              ))}
            />
          </section>
        )}

        <div className="space-y-4">
          <section className="card p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">Spectre de la matrice SCA</h3>
            <p className="mb-2 text-[13px] text-slate-500">
              Chaque barre est un mode de covariation. Les modes au-dessus de la ligne (alignements aléatoires de même
              conservation) portent un vrai signal ; le premier reflète surtout la conservation globale.
            </p>
            <Spectrum values={sca.eigenvalues} threshold={sca.random_threshold} />
          </section>

          <section className="card p-4">
            <h3 className="text-[16px] font-semibold text-slate-900">Secteurs</h3>
            <div className="mt-2 space-y-2">
              {sectors.map((s) => (
                <SectorCard key={s.id} sector={s} active={active === s.id} onClick={() => setActive(active === s.id ? null : s.id)} onSelect={onSelect} selected={selected} />
              ))}
              {sectors.length === 0 && <p className="text-[14px] text-slate-500">Aucun secteur ne se détache du bruit.</p>}
            </div>
          </section>
        </div>
      </div>

      <ScaControls sca={sca} />

      <section className="card p-4 text-[14px] leading-6 text-slate-600">
        <h3 className="mb-1 text-[16px] font-semibold text-slate-900">Méthode et lecture</h3>
        <p>
          {sca.method}. La SCA pondère chaque corrélation par la conservation des deux positions, puis cherche dans la
          matrice obtenue les directions qui ressortent au-dessus du hasard (comparaison à des alignements
          aléatoires où chaque colonne garde sa composition). Une analyse en composantes indépendantes sépare ensuite ces
          modes en groupes : les <b>secteurs</b>. Contrairement à la MIp, qui désigne des paires, un secteur est un
          ensemble de positions qui varient ensemble ; dans les protéines étudiées, ce sont souvent des réseaux
          physiquement connectés qui portent une fonction (site actif, transmission allostérique). La compacité compare la
          distance moyenne entre membres à celle de toute la protéine. {sca.neff} séquences effectives,{" "}
          {sca.valid_columns} positions analysées (colonnes à plus de 50 % de gaps exclues).
        </p>
      </section>
    </div>
  );
}

function SectorCard({
  sector,
  active,
  onClick,
  onSelect,
  selected,
}: {
  sector: Sector;
  active: boolean;
  onClick: () => void;
  onSelect: (position: number) => void;
  selected: number | null;
}) {
  const color = sectorColor(sector.id);
  const zones = Object.entries(sector.zones)
    .filter(([, n]) => n)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([z, n]) => `${ZONES[z as Zone]?.label.toLowerCase() ?? z} ${n}`)
    .join(" · ");
  return (
    <div className={`rounded-lg border p-3 ${active ? "border-slate-800 bg-slate-50" : "border-slate-200"}`}>
      <button onClick={onClick} className="flex w-full items-center gap-2 text-left text-[14px] font-semibold text-slate-900">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        Secteur {sector.id} · {sector.size} positions
        <span className="ml-auto text-[12px] font-normal text-slate-500">{active ? "tout afficher" : "isoler en 3D"}</span>
      </button>
      <p className="mt-0.5 text-[12px] text-slate-500">
        {sector.helices.length ? sector.helices.join(", ") : "hors hélices"} · grade moyen {sector.mean_grade}/9
        {sector.compactness != null ? ` · compacité ${sector.compactness}` : ""}
      </p>
      {zones && <p className="text-[12px] text-slate-500">{zones}</p>}
      {(sector.signal || sector.stability_label) && (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
          {sector.signal && <SignalBadge signal={sector.signal} />}
          {sector.stability_label && <span>· {sector.stability_label} au sous-échantillonnage ({sector.stability})</span>}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {[...sector.residues]
          .sort((a, b) => b.weight - a.weight)
          .map((r) => (
            <button
              key={r.position}
              onClick={() => onSelect(r.position)}
              title={`Contribution ${r.weight} · grade ${r.grade}/9`}
              className={`rounded px-1.5 py-0.5 font-mono text-[12px] font-semibold ${selected === r.position ? "ring-2 ring-slate-900" : ""}`}
              style={{ backgroundColor: `${color}22`, color }}
            >
              {r.residue}
              {r.position}
            </button>
          ))}
      </div>
    </div>
  );
}

function Spectrum({ values, threshold }: { values: number[]; threshold: number }) {
  const W = 520;
  const H = 150;
  const max = Math.max(...values, threshold) * 1.05;
  const bar = (W - 30) / values.length;
  const y = (v: number) => H - 18 - (v / max) * (H - 28);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Spectre des valeurs propres">
      {values.map((v, k) => (
        <rect key={k} x={26 + k * bar + 1} y={y(v)} width={bar - 2} height={H - 18 - y(v)} fill={v > threshold ? "#7c3aed" : "#cbd5e1"}>
          <title>{`Mode ${k + 1} : ${v}`}</title>
        </rect>
      ))}
      <line x1={26} x2={W} y1={y(threshold)} y2={y(threshold)} stroke="#e11d48" strokeDasharray="4 3" />
      <text x={W - 4} y={y(threshold) - 4} fontSize="10" textAnchor="end" fill="#e11d48">
        hasard
      </text>
      <text x={26} y={H - 4} fontSize="10" fill="#64748b">
        mode 1
      </text>
      <text x={W - 4} y={H - 4} fontSize="10" textAnchor="end" fill="#64748b">
        mode {values.length}
      </text>
    </svg>
  );
}
