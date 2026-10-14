"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, GitBranch, Layers, Loader2, Play, ShieldCheck, Users } from "lucide-react";
import { StatCard } from "@/components/ui";
import PhyloTree from "@/components/evolution/PhyloTree";
import RerunNotice from "./RerunNotice";
import type { PhyloNode, PhyloTree as PhyloTreeData, TreeModel } from "@/lib/conservation";
import { MAX_TREE_SELECTION, submitTree, useTreeJob, type ExplorerResult } from "@/lib/explorer";

const MIN_HOMOLOGS = 3;

const MODELS: { value: TreeModel; label: string; text: string }[] = [
  { value: "kimura", label: "Kimura (protéines)", text: "d = −ln(1 − p − 0,2 p²) : corrige les substitutions multiples (recommandé)" },
  { value: "poisson", label: "Poisson", text: "d = −ln(1 − p) : correction plus légère" },
  { value: "p", label: "Distance p", text: "d = p : sans correction, pour des séquences proches" },
];

// Limites valables pour tout arbre de distances, quel que soit l'alignement
const GENERAL_LIMITS = [
  "C’est un arbre de gènes, pas un arbre des espèces : duplications (paralogues), pertes et transferts horizontaux peuvent l’en écarter.",
  "La racine est placée au milieu du plus long chemin, sans groupe externe : l’ordre des embranchements n’est pas une chronologie.",
  "Neighbor-Joining est une méthode de distances, rapide mais moins précise que le maximum de vraisemblance (IQ-TREE, RAxML) : pour une publication, refaites l’arbre avec ces outils à partir du FASTA de l’alignement.",
  "Seuls les groupes soutenus (bootstrap ≥ 70 %) sont interprétables ; un bootstrap élevé mesure la stabilité vis-à-vis des colonnes, pas la justesse du modèle.",
];

const RELIABILITY = {
  correcte: { label: "Fiabilité correcte", tone: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: <CheckCircle2 size={16} /> },
  prudence: { label: "À interpréter avec prudence", tone: "border-amber-200 bg-amber-50 text-amber-900", icon: <AlertTriangle size={16} /> },
  insuffisante: { label: "Alignement insuffisant pour un arbre fiable", tone: "border-rose-200 bg-rose-50 text-rose-900", icon: <AlertTriangle size={16} /> },
};

/** Arbre phylogénétique de la référence et des homologues (choisis ou les plus proches). */
export default function PhylogenyTab({
  result,
  jobId,
  fileBase,
  onRerun,
}: {
  result: ExplorerResult;
  jobId: string;
  fileBase: string;
  /** Relance la même analyse avec la méthode actuelle (analyses antérieures à l'arbre). */
  onRerun?: () => Promise<void>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Arbre construit sur une sélection : identifiant de sa tâche dans l'adresse (?arbre=…)
  const treeJobId = params.get("arbre");
  const treeJob = useTreeJob(treeJobId);
  const custom = treeJob.status === "succeeded" && treeJob.result?.parent === jobId ? treeJob.result.tree : null;
  const tree = custom ?? result.tree ?? null;
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);

  const showTree = (id: string | null) =>
    router.replace(`/explorateur/${jobId}?tab=phylogenie${id ? `&arbre=${encodeURIComponent(id)}` : ""}`, { scroll: false });

  const supports = useMemo(() => {
    const values: number[] = [];
    const walk = (node: PhyloNode) => {
      if (node.support !== undefined && node.support !== null) values.push(node.support);
      node.children?.forEach(walk);
    };
    if (tree) walk(tree.root);
    return values;
  }, [tree]);

  if (!result.tree && !custom) {
    if (result.version < 2) {
      return <RerunNotice title="Cette analyse a été lancée avant l’ajout de l’arbre phylogénétique." button="Recalculer avec l’arbre" onRerun={onRerun} />;
    }
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-[15px] text-slate-700">
        Pas d’arbre phylogénétique pour cette analyse : il faut au moins 4 séquences.
      </p>
    );
  }
  const shown = tree!;
  const identities = shown.leaves.filter((l) => !l.is_query && l.identity !== null).map((l) => l.identity!);
  const lowest = identities.length ? Math.min(...identities) : null;
  const strong = shown.support?.strong ?? 0.7;

  return (
    <div className="space-y-4">
      {treeJobId && treeJob.status !== "succeeded" && (
        <p
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[14px] ${
            treeJob.status === "failed" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          {treeJob.status === "failed" ? <AlertTriangle size={16} /> : <Loader2 size={16} className="animate-spin text-cyan-600" />}
          {treeJob.status === "failed" ? `Arbre impossible : ${treeJob.error}` : "Construction de l’arbre sur les séquences choisies…"}
          <button onClick={() => showTree(null)} className="ml-auto font-semibold hover:underline">
            Revenir à l’arbre de l’analyse
          </button>
        </p>
      )}
      {custom && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[14px] text-violet-900">
          Arbre construit sur {custom.leaf_count - 1} homologue(s) choisi(s) et la référence.
          <button onClick={() => showTree(null)} className="ml-auto font-semibold hover:underline">
            Revenir à l’arbre de l’analyse
          </button>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          tone="violet"
          icon={<GitBranch size={15} />}
          label="Séquences"
          value={`${shown.leaf_count}`}
          hint={custom ? "sélection personnalisée" : result.input.kept + 1 > shown.leaf_count ? `les ${shown.leaf_count - 1} homologues les plus proches` : "toute la famille"}
        />
        <StatCard
          tone="blue"
          icon={<Users size={15} />}
          label={shown.group_rank_label ? `Groupes (${shown.group_rank_label.toLowerCase()})` : "Groupes"}
          value={`${shown.groups.length}`}
          hint={shown.groups.slice(0, 3).map((g) => g.name).join(", ") || "taxonomie inconnue"}
        />
        <StatCard
          tone="emerald"
          icon={<ShieldCheck size={15} />}
          label="Branches robustes"
          value={supports.length ? `${supports.filter((s) => s >= strong).length} / ${supports.length}` : "—"}
          hint={`bootstrap ≥ ${Math.round(strong * 100)} % sur ${shown.bootstrap_replicates} réplicats`}
        />
        <StatCard
          tone="amber"
          icon={<Layers size={15} />}
          label="Sites informatifs"
          value={shown.diagnostics ? `${shown.diagnostics.informative_sites}` : lowest !== null ? `${Math.round(lowest * 100)} %` : "—"}
          hint={shown.diagnostics ? `sur ${shown.diagnostics.columns} colonnes utilisées` : "identité la plus faible avec la référence"}
        />
      </div>

      <Limits tree={shown} />

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <PhyloTree key={custom ? treeJobId : "analysis"} tree={shown} selectedId={selectedSpecies} onSelect={setSelectedSpecies} fileBase={fileBase} maxHeight={900} />
      </section>

      <SequencePicker key={custom ? treeJobId : "analysis"} result={result} tree={shown} jobId={jobId} onBuilt={showTree} />

      <Method tree={shown} />
    </div>
  );
}

/** Fiabilité de l'arbre et limites d'interprétation. */
function Limits({ tree }: { tree: PhyloTreeData }) {
  const level = tree.reliability ? RELIABILITY[tree.reliability] : null;
  return (
    <section className={`rounded-lg border p-4 ${level ? level.tone : "border-slate-200 bg-white text-slate-800"}`}>
      <h3 className="flex items-center gap-2 text-[16px] font-semibold">
        {level?.icon}
        {level ? level.label : "Limites d’interprétation"}
      </h3>
      {tree.limits && tree.limits.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-5">
          {tree.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      )}
      {tree.limits && tree.limits.length === 0 && (
        <p className="mt-1 text-[14px]">Assez de séquences, de sites informatifs et de branches soutenues pour lire les grands groupes.</p>
      )}
      {!tree.limits && <p className="mt-1 text-[14px]">Diagnostic indisponible pour cet arbre ancien : recalculez l’analyse ou construisez un arbre ci-dessous.</p>}
      <details className="mt-2 text-[13px]">
        <summary className="cursor-pointer font-semibold">Limites valables pour tout arbre de ce type</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 leading-5">
          {GENERAL_LIMITS.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Méthode de reconstruction, modèle de distance, racine, support et alignement utilisé. */
function Method({ tree }: { tree: PhyloTreeData }) {
  const d = tree.diagnostics;
  const items: [string, React.ReactNode][] = [
    ["Reconstruction", tree.reconstruction ?? "Neighbor-Joining (Saitou & Nei, 1987)"],
    [
      "Modèle de distance",
      tree.model ? (
        <>
          {tree.model.label} : <span className="font-mono">{tree.model.formula}</span>, p étant la proportion d’acides aminés
          différents sur les positions alignées des deux séquences. {tree.model.text}
        </>
      ) : (
        "Kimura (1983) pour les protéines"
      ),
    ],
    ["Racine", tree.rooting ?? "Point médian du plus long chemin entre deux séquences"],
    [
      "Support des branches",
      `${tree.support?.method ?? "Bootstrap (Felsenstein, 1985)"} : ${tree.bootstrap_replicates} réplicats où les colonnes de l’alignement sont tirées avec remise ; la valeur d’un embranchement est la part des réplicats qui le retrouvent.`,
    ],
  ];
  if (d) {
    items.push([
      "Alignement utilisé",
      `${d.columns} colonnes${d.masked_columns ? ` (${d.masked_columns} masquées par le contrôle qualité exclues)` : ""}, ${d.informative_sites} sites informatifs, recouvrement moyen des paires ${
        d.mean_overlap != null ? Math.round(d.mean_overlap * 100) : "—"
      } %, bootstrap moyen ${d.mean_support != null ? Math.round(d.mean_support * 100) : "—"} %.`,
    ]);
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-[14px] leading-6 text-slate-600">
      <h3 className="mb-2 text-[16px] font-semibold text-slate-900">Méthode</h3>
      <dl className="grid gap-x-4 gap-y-2 md:grid-cols-[180px_1fr]">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold text-slate-800">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[13px] text-slate-500">
        Une espèce mal placée peut signaler une duplication (paralogue) ou une séquence incomplète. L’alignement peut être
        affiché dans l’ordre de l’arbre dans l’onglet Conservation.
      </p>
    </section>
  );
}

/** Choix des homologues à placer dans l'arbre (la référence est toujours incluse). */
function SequencePicker({
  result,
  tree,
  jobId,
  onBuilt,
}: {
  result: ExplorerResult;
  tree: PhyloTreeData;
  jobId: string;
  onBuilt: (treeJobId: string) => void;
}) {
  const candidates = useMemo(() => {
    const homologs = new Map(result.homologs.map((h) => [h.accession, h]));
    return result.msa
      .map((m) => {
        const h = homologs.get(m.accession);
        return { id: m.accession, organism: h?.organism ?? null, identity: h?.identity ?? 0, coverage: h?.coverage ?? 0, taxon: h?.taxon_id ?? null };
      })
      .sort((a, b) => b.identity - a.identity);
  }, [result]);
  const current = useMemo(() => new Set(tree.leaves.filter((l) => !l.is_query).map((l) => l.id)), [tree]);
  const [chosen, setChosen] = useState<Set<string>>(current);
  const [model, setModel] = useState<TreeModel>(tree.model?.id ?? "kimura");
  const [closest, setClosest] = useState(50);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = filter.trim().toLowerCase();
  const shown = text ? candidates.filter((c) => [c.id, c.organism].some((v) => v?.toLowerCase().includes(text))) : candidates;
  const same = chosen.size === current.size && [...chosen].every((id) => current.has(id)) && model === (tree.model?.id ?? "kimura");
  const count = chosen.size;
  const invalid = count < MIN_HOMOLOGS || count > MAX_TREE_SELECTION;

  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const onePerSpecies = () => {
    const seen = new Set<string>();
    const ids = candidates.filter((c) => {
      const key = c.taxon ? `t${c.taxon}` : c.organism ? `o${c.organism}` : `i${c.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setChosen(new Set(ids.slice(0, MAX_TREE_SELECTION).map((c) => c.id)));
  };

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const job = await submitTree(jobId, [...chosen], model);
      onBuilt(job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-[16px] font-semibold text-slate-900">Séquences de l’arbre</h3>
        <p className="text-[13px] text-slate-500">
          Choisissez les homologues à placer dans l’arbre (la référence est toujours incluse), de {MIN_HOMOLOGS} à {MAX_TREE_SELECTION}.
          L’arbre est reconstruit en quelques secondes à partir de l’alignement de cette analyse, sans recalculer le reste.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[13px]">
        <span className="flex items-center gap-1">
          Les
          <input
            type="number"
            min={MIN_HOMOLOGS}
            max={MAX_TREE_SELECTION}
            value={closest}
            onChange={(e) => setClosest(Math.max(MIN_HOMOLOGS, Math.min(MAX_TREE_SELECTION, Number(e.target.value) || MIN_HOMOLOGS)))}
            className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 text-right tabular-nums"
          />
          <button onClick={() => setChosen(new Set(candidates.slice(0, closest).map((c) => c.id)))} className="rounded-md border border-slate-300 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-50">
            plus proches
          </button>
        </span>
        <button onClick={onePerSpecies} className="rounded-md border border-slate-300 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-50" title="La plus proche de la référence pour chaque espèce">
          Une par espèce
        </button>
        <button onClick={() => setChosen(new Set(current))} className="rounded-md border border-slate-300 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-50">
          Celles de l’arbre affiché
        </button>
        <button onClick={() => setChosen(new Set())} className="rounded-md border border-slate-300 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-50">
          Aucune
        </button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer (espèce, identifiant…)"
          className="ml-auto w-56 rounded-md border border-slate-300 px-2 py-1 outline-none focus:border-blue-500"
        />
      </div>
      <div className="max-h-72 overflow-auto border-y border-slate-100">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="w-8 px-3 py-1.5" />
              <th className="px-3 py-1.5 font-semibold">Identifiant</th>
              <th className="px-3 py-1.5 font-semibold">Espèce</th>
              <th className="px-3 py-1.5 text-right font-semibold">Identité</th>
              <th className="px-3 py-1.5 text-right font-semibold">Couverture</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1">
                  <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Inclure ${c.id}`} />
                </td>
                <td className="px-3 py-1 font-mono">{c.id}</td>
                <td className="max-w-[260px] truncate px-3 py-1 italic">{c.organism ?? "—"}</td>
                <td className="px-3 py-1 text-right tabular-nums">{Math.round(c.identity * 100)} %</td>
                <td className="px-3 py-1 text-right tabular-nums">{Math.round(c.coverage * 100)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
        <label className="flex items-center gap-1.5">
          Modèle de distance
          <select value={model} onChange={(e) => setModel(e.target.value as TreeModel)} className="rounded-md border border-slate-300 px-2 py-1 outline-none focus:border-blue-500">
            {MODELS.map((m) => (
              <option key={m.value} value={m.value} title={m.text}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-slate-500">{MODELS.find((m) => m.value === model)?.text}</span>
        <span className={`ml-auto font-semibold ${invalid ? "text-rose-700" : "text-slate-700"}`}>
          {count} homologue(s) + la référence
        </span>
        <button
          onClick={build}
          disabled={invalid || same || busy}
          title={same ? "Même sélection et même modèle que l’arbre affiché" : undefined}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0f4c81] px-3 py-1.5 font-semibold text-white hover:bg-[#0c3d68] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Construire l’arbre
        </button>
      </div>
      {count > 0 && count < 7 && (
        <p className="px-4 pb-3 text-[13px] text-amber-800">Moins de 8 séquences au total : la topologie sera très incertaine.</p>
      )}
      {error && <p className="px-4 pb-3 text-[13px] text-rose-700">Arbre impossible : {error}</p>}
    </section>
  );
}
