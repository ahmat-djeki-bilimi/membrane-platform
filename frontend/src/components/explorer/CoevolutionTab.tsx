"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Download } from "lucide-react";
import { Alert, SegmentedControl, StatCard } from "@/components/ui";
import { Activity, Link2, Network as NetworkIcon, Target } from "lucide-react";
import { NETWORK_COLORS, PAIR_KINDS, pairsCsv, type CoevolutionPair, type ExplorerResult } from "@/lib/explorer";
import { downloadText } from "@/lib/sequence";
import ComparisonView from "./ComparisonView";
import { LegendItem, type ResidueLink, type ResidueMark } from "./ExplorerViewer";
import ScaView from "./ScaView";

const ExplorerViewer = dynamic(() => import("./ExplorerViewer"), { ssr: false });

type Depth = "10" | "5" | "2";
type View = "pairs" | "networks";

const CONFIRMED = "#16a34a";
const UNCONFIRMED = "#f97316";
const UNKNOWN = "#2563eb";
const RELIABILITY_TONE = { insuffisante: "rose", faible: "amber", moyenne: "cyan", bonne: "emerald" } as const;

const pairColor = (p: CoevolutionPair) => (p.contact === undefined || p.distance == null ? UNKNOWN : p.contact ? CONFIRMED : UNCONFIRMED);
const pct = (v?: number | null) => (v == null ? "—" : `${Math.round(v * 100)} %`);

type Method = "mip" | "sca" | "comparison";

const METHODS: { value: Method; label: string; text: string }[] = [
  { value: "mip", label: "MIp — paires corrélées", text: "Information mutuelle corrigée (APC) : paires de positions et réseaux qu’elles forment." },
  { value: "sca", label: "SCA — secteurs", text: "Statistical Coupling Analysis : groupes de positions conservées qui varient ensemble." },
  { value: "comparison", label: "Comparaison MIp / SCA", text: "Résidus retenus par une méthode, par l’autre, ou par les deux." },
];

/**
 * Coévolution : deux méthodes sur le même alignement (MIp et SCA), chacune
 * cartographiée sur la structure placée dans la membrane, puis comparées.
 */
export default function CoevolutionTab({
  result,
  selected,
  onSelect,
  fileBase,
  onRerun,
}: {
  result: ExplorerResult;
  selected: number | null;
  onSelect: (position: number) => void;
  fileBase: string;
  onRerun?: () => Promise<void>;
}) {
  // Vue gardée dans l'adresse (?vue=sca) pour pouvoir la partager
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("vue");
  const method: Method = METHODS.some((m) => m.value === wanted) ? (wanted as Method) : "mip";
  const setMethod = (next: Method) => {
    const query = new URLSearchParams(params.toString());
    query.set("vue", next);
    router.replace(`?${query.toString()}`, { scroll: false });
  };
  const current = METHODS.find((m) => m.value === method)!;
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl label="Méthode" value={method} onChange={setMethod} options={METHODS.map(({ value, label }) => ({ value, label }))} />
          <span className="text-[13px] text-slate-500">{current.text}</span>
        </div>
        <p className="mt-2 text-[12px] text-slate-400">
          Alignement multiple → MIp (réseaux de paires) et SCA (secteurs) → cartographie sur la structure orientée dans la
          membrane → comparaison.
        </p>
      </section>
      {method === "mip" && <MipView result={result} selected={selected} onSelect={onSelect} fileBase={fileBase} />}
      {method === "sca" && <ScaView result={result} selected={selected} onSelect={onSelect} onRerun={onRerun} />}
      {method === "comparison" && <ComparisonView result={result} selected={selected} onSelect={onSelect} onRerun={onRerun} />}
    </div>
  );
}

/** MIp : paires corrélées, carte de contacts, réseaux. */
function MipView({
  result,
  selected,
  onSelect,
  fileBase,
}: {
  result: ExplorerResult;
  selected: number | null;
  onSelect: (position: number) => void;
  fileBase: string;
}) {
  const coevolution = result.coevolution;
  const [depth, setDepth] = useState<Depth>("5");
  const [view, setView] = useState<View>("pairs");
  const [network, setNetwork] = useState<number | null>(null);
  const length = result.length;

  const pairs = useMemo(
    () => (coevolution ? coevolution.pairs.slice(0, Math.max(1, Math.floor(length / Number(depth)))) : []),
    [coevolution, length, depth]
  );

  const links: ResidueLink[] = useMemo(() => {
    if (view === "pairs") return pairs.map((p) => ({ i: p.i, j: p.j, color: pairColor(p), dashed: p.contact === false }));
    return result.networks
      .filter((n) => network === null || n.id === network)
      .flatMap((n) => n.links.map(([i, j]) => ({ i, j, color: NETWORK_COLORS[(n.id - 1) % NETWORK_COLORS.length] })));
  }, [view, pairs, result.networks, network]);

  const colors = useMemo(() => {
    const map = new Map<number, string>();
    if (view === "pairs") {
      for (const p of pairs) {
        map.set(p.i, "#64748b");
        map.set(p.j, "#64748b");
      }
    } else {
      for (const n of result.networks) {
        if (network !== null && n.id !== network) continue;
        for (const r of n.residues) map.set(r.position, NETWORK_COLORS[(n.id - 1) % NETWORK_COLORS.length]);
      }
    }
    return map;
  }, [view, pairs, result.networks, network]);

  const marks: ResidueMark[] = useMemo(() => {
    if (view !== "networks") return selected ? [{ position: selected, color: "#7c3aed", label: `${result.positions[selected - 1]?.residue}${selected}` }] : [];
    return result.networks
      .filter((n) => network === null || n.id === network)
      .flatMap((n) => n.residues.map((r) => ({ position: r.position, color: NETWORK_COLORS[(n.id - 1) % NETWORK_COLORS.length], label: network !== null ? `${r.residue}${r.position}` : undefined })));
  }, [view, result.networks, network, selected, result.positions]);

  if (!coevolution) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-[14px] text-slate-600">
        La coévolution n’a pas été calculée (séquence de référence de plus de 1 500 résidus ou alignement trop petit).
      </p>
    );
  }

  const precision = Object.fromEntries(coevolution.precision.map((p) => [p.label, p]));
  const reliability = coevolution.reliability;
  const interHelix = pairs.filter((p) => p.kind === "inter_helix").length;

  return (
    <div className="space-y-4">
      <Alert tone={RELIABILITY_TONE[reliability.level]} title={`Fiabilité ${reliability.level} — ${coevolution.neff} séquences effectives pour ${coevolution.length} positions`}>
        {reliability.text}
        {!result.input.expanded && (reliability.level === "insuffisante" || reliability.level === "faible") && (
          <> Relancez l’analyse avec la <b>recherche étendue (MMseqs2)</b> pour approfondir l’alignement.</>
        )}
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="violet" icon={<Activity size={15} />} label="Neff / L" value={`${reliability.neff_per_length}`} hint="profondeur effective de l’alignement" />
        <StatCard
          tone="emerald"
          icon={<Target size={15} />}
          label="Précision L/5"
          value={pct(precision["L/5"]?.precision)}
          hint={coevolution.random_precision != null ? `paires en contact dans le modèle (hasard : ${pct(coevolution.random_precision)})` : "aucune structure pour vérifier"}
        />
        <StatCard tone="amber" icon={<Link2 size={15} />} label="Entre hélices" value={`${interHelix} / ${pairs.length}`} hint="paires affichées reliant deux hélices TM" />
        <StatCard tone="cyan" icon={<NetworkIcon size={15} />} label="Réseaux" value={`${result.networks.length}`} hint={`à partir de ${coevolution.strong_pairs} paires fortes (z ≥ 3)`} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px]">
        <span className="font-semibold text-slate-800">Paires affichées</span>
        <SegmentedControl
          label="Nombre de paires"
          value={depth}
          onChange={setDepth}
          options={[
            { value: "10", label: `L/10 (${Math.floor(length / 10)})` },
            { value: "5", label: `L/5 (${Math.floor(length / 5)})` },
            { value: "2", label: `L/2 (${Math.floor(length / 2)})` },
          ]}
        />
        <span className="text-slate-500">L = longueur de la référence ; les premières paires sont les plus sûres.</span>
        <button
          onClick={() => downloadText(`${fileBase}_coevolution.csv`, pairsCsv(coevolution.pairs), "text/csv")}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          <Download size={13} />
          Toutes les paires (CSV)
        </button>
      </div>

      <div className={`grid gap-4 ${result.structure ? "xl:grid-cols-2" : ""}`}>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-[16px] font-semibold text-slate-900">Carte de contacts</h3>
          <p className="mb-2 text-[13px] text-slate-500">
            En haut à droite : paires qui coévoluent{result.structure ? " (vert : en contact dans le modèle, orange : éloignées)" : ""}.
            {result.structure ? " En bas à gauche : contacts réels du modèle (Cβ < 8 Å)." : ""} Bandes : hélices TM.
          </p>
          <ContactMap result={result} pairs={pairs} selected={selected} onSelect={onSelect} />
        </section>

        {result.structure && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[16px] font-semibold text-slate-900">Coévolution dans la structure</h3>
              <SegmentedControl
                label="Affichage"
                value={view}
                onChange={setView}
                options={[
                  { value: "pairs", label: "Paires" },
                  { value: "networks", label: "Réseaux", disabled: result.networks.length === 0 },
                ]}
              />
            </div>
            <ExplorerViewer
              pdb={result.structure.pdb}
              colors={colors}
              links={links}
              marks={marks}
              focus={view === "pairs" ? selected : null}
              height={480}
              legend={
                view === "pairs" ? (
                  <>
                    <LegendItem color={CONFIRMED} label="Paire en contact (< 8 Å)" />
                    <LegendItem color={UNCONFIRMED} label="Paire éloignée (pointillés)" />
                  </>
                ) : (
                  <span>Une couleur par réseau</span>
                )
              }
            />
          </section>
        )}
      </div>

      {result.networks.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-[16px] font-semibold text-slate-900">Réseaux de résidus couplés</h3>
          <p className="mb-3 text-[13px] text-slate-500">
            Groupes de positions reliées par des paires fortes : candidats pour des interactions entre hélices, la stabilité
            ou un changement fonctionnel concerté. Cliquez un réseau pour l’isoler en 3D.
          </p>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {result.networks.map((n) => {
              const color = NETWORK_COLORS[(n.id - 1) % NETWORK_COLORS.length];
              const active = network === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    setView("networks");
                    setNetwork(active ? null : n.id);
                  }}
                  className={`rounded-md border p-3 text-left ${active ? "border-slate-800 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <p className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                    Réseau {n.id} · {n.size} positions
                  </p>
                  <p className="mt-0.5 text-[12px] text-slate-500">
                    {n.helices.length ? n.helices.join(", ") : "hors hélices"} · grade moyen {n.mean_grade}/9
                    {n.with_distance ? ` · ${n.contacts}/${n.with_distance} liens en contact` : ""}
                  </p>
                  <p className="mt-1 font-mono text-[12px] leading-5 text-slate-700">
                    {n.residues.map((r) => `${r.residue}${r.position}`).join(" ")}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-2.5 text-[16px] font-semibold text-slate-900">Paires de positions ({pairs.length})</h3>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Rang</th>
                <th className="px-3 py-1.5 font-semibold">Paire</th>
                <th className="px-3 py-1.5 font-semibold">Régions</th>
                <th className="px-3 py-1.5 font-semibold">Type</th>
                <th className="px-3 py-1.5 text-right font-semibold">z</th>
                <th className="px-3 py-1.5 text-right font-semibold">Distance</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, k) => {
                const a = result.positions[p.i - 1];
                const b = result.positions[p.j - 1];
                return (
                  <tr
                    key={`${p.i}-${p.j}`}
                    onClick={() => onSelect(p.i)}
                    className={`cursor-pointer border-t border-slate-100 ${selected === p.i || selected === p.j ? "bg-violet-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-3 py-1.5 tabular-nums text-slate-500">{k + 1}</td>
                    <td className="px-3 py-1.5 font-mono font-semibold">
                      {a?.residue}
                      {p.i} – {b?.residue}
                      {p.j}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {p.region_i ?? "—"} / {p.region_j ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">{PAIR_KINDS[p.kind]}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.z.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: pairColor(p) }}>
                      {p.distance != null ? `${p.distance} Å` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-[13px] leading-5 text-slate-500">
          Méthode : {coevolution.method}. Séquences pondérées (identité ≥ 80 %), colonnes à plus de 50 % de gaps exclues,
          positions séparées d’au moins {coevolution.min_separation} résidus. z : écart du score à la moyenne de toutes
          les paires, en écarts-types.
        </p>
      </section>
    </div>
  );
}

/** Carte de contacts : paires prédites (triangle supérieur), contacts du modèle (triangle inférieur). */
function ContactMap({
  result,
  pairs,
  selected,
  onSelect,
}: {
  result: ExplorerResult;
  pairs: CoevolutionPair[];
  selected: number | null;
  onSelect: (position: number) => void;
}) {
  const S = 560;
  const M = 28;
  const L = result.length;
  const scale = (S - M - 6) / L;
  const at = (pos: number) => M + (pos - 0.5) * scale;
  const dot = Math.max(1.6, Math.min(5, scale * 1.4));
  const contacts = result.structure?.contacts ?? [];
  const ticks = L > 600 ? 200 : L > 250 ? 100 : 50;

  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto w-full max-w-[560px]" role="img" aria-label="Carte de contacts">
      <rect x={M} y={M} width={L * scale} height={L * scale} fill="#f8fafc" stroke="#cbd5e1" />
      {result.topology.segments.map((s) => (
        <g key={s.label}>
          <rect x={M + (s.start - 1) * scale} y={M} width={(s.end - s.start + 1) * scale} height={L * scale} fill="#fde68a" opacity={0.25} />
          <rect x={M} y={M + (s.start - 1) * scale} width={L * scale} height={(s.end - s.start + 1) * scale} fill="#fde68a" opacity={0.25} />
          <text x={at((s.start + s.end) / 2)} y={M - 6} fontSize="9" textAnchor="middle" fill="#b45309">
            {s.label.replace(/ \(estimé\)/, "")}
          </text>
        </g>
      ))}
      <line x1={M} y1={M} x2={M + L * scale} y2={M + L * scale} stroke="#cbd5e1" />
      {Array.from({ length: Math.floor(L / ticks) }, (_, k) => (k + 1) * ticks).map((t) => (
        <text key={t} x={M - 4} y={at(t) + 3} fontSize="9" textAnchor="end" fill="#64748b">
          {t}
        </text>
      ))}
      {contacts.map(([i, j]) => (
        <rect key={`c${i}-${j}`} x={at(i) - dot / 2} y={at(j) - dot / 2} width={dot} height={dot} fill="#94a3b8" opacity={0.6} />
      ))}
      {pairs.map((p) => (
        <circle
          key={`p${p.i}-${p.j}`}
          cx={at(p.j)}
          cy={at(p.i)}
          r={selected === p.i || selected === p.j ? dot * 1.4 : dot * 0.9}
          fill={pairColor(p)}
          stroke={selected === p.i || selected === p.j ? "#1e1b4b" : "none"}
          className="cursor-pointer"
          onClick={() => onSelect(p.i)}
        >
          <title>{`${p.i} – ${p.j} · z = ${p.z}${p.distance != null ? ` · ${p.distance} Å` : ""}`}</title>
        </circle>
      ))}
    </svg>
  );
}
