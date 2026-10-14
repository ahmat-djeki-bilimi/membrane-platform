"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Cpu, GitBranch, Layers, ListChecks, Loader2, Play, ShieldCheck, Sigma, XCircle, Zap } from "lucide-react";
import { StatCard } from "@/components/ui";
import PhyloTree from "@/components/evolution/PhyloTree";
import RerunNotice from "./RerunNotice";
import type { CheckState, PhyloNode, PhyloTree as PhyloTreeData, TreeModel, TreeSelection, TreeStrategy } from "@/lib/conservation";
import {
  MAX_TREE_SELECTION,
  fetchPhylogenyTools,
  fetchTreeSelection,
  submitTree,
  useTreeJob,
  type ExplorerResult,
  type PhylogenyTools,
  type TreeRequest,
} from "@/lib/explorer";

const MIN_HOMOLOGS = 3;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`);

const DISTANCE_MODELS: { value: TreeModel; label: string; text: string }[] = [
  { value: "kimura", label: "Kimura (protéines)", text: "d = −ln(1 − p − 0,2 p²) : corrige les substitutions multiples (recommandé)" },
  { value: "poisson", label: "Poisson", text: "d = −ln(1 − p) : correction plus légère" },
  { value: "p", label: "Distance p", text: "d = p : sans correction, pour des séquences proches" },
];

const STRATEGY_ORDER: TreeStrategy[] = ["closest", "taxonomic", "diversity", "custom"];

// Limites valables pour tout arbre de ce type, quel que soit l'alignement
const GENERAL_LIMITS = [
  "C’est un arbre de gènes, pas un arbre des espèces : duplications (paralogues), pertes et transferts horizontaux peuvent l’en écarter.",
  "La racine est placée au milieu du plus long chemin, sans groupe externe : l’ordre des embranchements n’est pas une chronologie.",
  "Neighbor-Joining est rapide mais moins précis que le maximum de vraisemblance : pour une publication, préférez IQ-TREE (ci-dessous).",
  "Un support élevé mesure la stabilité de l’arbre vis-à-vis des colonnes de l’alignement, pas la justesse du modèle ni de l’alignement.",
  "Le choix des séquences change l’arbre : les plus proches détaillent le voisinage de la référence, l’échantillonnage taxonomique ou par diversité représente mieux la famille.",
];

const STATE_STYLE: Record<CheckState, { tone: string; icon: React.ReactNode; label: string }> = {
  ok: { tone: "text-emerald-700", icon: <CheckCircle2 size={14} />, label: "Correct" },
  attention: { tone: "text-amber-700", icon: <AlertTriangle size={14} />, label: "Attention" },
  probleme: { tone: "text-rose-700", icon: <XCircle size={14} />, label: "Problème" },
};

const LEVEL_STYLE = {
  correcte: "border-emerald-200 bg-emerald-50 text-emerald-900",
  prudence: "border-amber-200 bg-amber-50 text-amber-900",
  insuffisante: "border-rose-200 bg-rose-50 text-rose-900",
};

/** Arbre phylogénétique : stratégie de sélection, méthode, diagnostics, arbre. */
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
  const [tools, setTools] = useState<PhylogenyTools | null>(null);

  useEffect(() => {
    fetchPhylogenyTools()
      .then(setTools)
      .catch(() => setTools(null));
  }, []);

  const showTree = (id: string | null) =>
    router.replace(`/explorateur/${jobId}?tab=phylogenie${id ? `&arbre=${encodeURIComponent(id)}` : ""}`, { scroll: false });

  if (!result.tree && !custom) {
    if (result.version < 2) {
      return <RerunNotice title="Cette analyse a été lancée avant l’ajout de l’arbre phylogénétique." button="Recalculer avec l’arbre" onRerun={onRerun} />;
    }
    return (
      <p className="card p-4 text-[15px] text-slate-700">
        Pas d’arbre phylogénétique pour cette analyse : il faut au moins 4 séquences.
      </p>
    );
  }
  const shown = tree!;

  return (
    <div className="space-y-4">
      {treeJobId && treeJob.status !== "succeeded" && (
        <p
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[14px] ${
            treeJob.status === "failed" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          {treeJob.status === "failed" ? <AlertTriangle size={16} /> : <Loader2 size={16} className="animate-spin text-cyan-600" />}
          {treeJob.status === "failed"
            ? `Arbre impossible : ${treeJob.error}`
            : "Construction de l’arbre… (Neighbor-Joining : quelques secondes ; IQ-TREE : quelques minutes)"}
          <button onClick={() => showTree(null)} className="ml-auto font-semibold hover:underline">
            Revenir à l’arbre de l’analyse
          </button>
        </p>
      )}
      {custom && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[14px] text-violet-900">
          Arbre construit sur une sélection{custom.selection ? ` : ${custom.selection.label.toLowerCase()}` : ""}.
          <button onClick={() => showTree(null)} className="ml-auto font-semibold hover:underline">
            Revenir à l’arbre de l’analyse
          </button>
        </p>
      )}

      <TreeSummary tree={shown} isAnalysisTree={!custom} totalHomologs={result.input.kept} />

      {shown.data_quality && shown.robustness ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <DataQualityPanel tree={shown} />
          <RobustnessPanel tree={shown} />
        </div>
      ) : (
        <p className="card p-4 text-[14px] text-slate-600">
          Diagnostics détaillés indisponibles pour cet arbre ancien : construisez un nouvel arbre ci-dessous.
        </p>
      )}

      <details className="card px-4 py-3 text-[13px]">
        <summary className="cursor-pointer font-semibold text-slate-800">Limites valables pour tout arbre de ce type</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 leading-5 text-slate-700">
          {GENERAL_LIMITS.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>

      <section className="card p-4">
        <PhyloTree key={custom ? treeJobId : "analysis"} tree={shown} selectedId={selectedSpecies} onSelect={setSelectedSpecies} fileBase={fileBase} maxHeight={900} />
      </section>

      <TreeBuilder key={custom ? treeJobId : "analysis"} result={result} tree={shown} jobId={jobId} tools={tools} onBuilt={showTree} />

      <Method tree={shown} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiche de l'arbre
// ---------------------------------------------------------------------------

function supportValues(root: PhyloNode): number[] {
  const values: number[] = [];
  const walk = (node: PhyloNode) => {
    if (node.support !== undefined && node.support !== null) values.push(node.support);
    node.children?.forEach(walk);
  };
  walk(root);
  return values;
}

function TreeSummary({ tree, isAnalysisTree, totalHomologs }: { tree: PhyloTreeData; isAnalysisTree: boolean; totalHomologs: number }) {
  const values = useMemo(() => supportValues(tree.root), [tree]);
  const robust = tree.robustness;
  const at70 = robust ? robust.supported_70 : values.filter((v) => v >= 0.7).length;
  const internal = robust ? robust.internal_branches : values.length;
  const ml = tree.method_id === "ml";
  const d = tree.diagnostics;
  return (
    <section className="card p-4">
      <h3 className="text-[16px] font-semibold text-slate-900">Fiche de l’arbre</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          tone="violet"
          icon={<GitBranch size={15} />}
          label="Séquences utilisées"
          value={`${tree.leaf_count}`}
          hint={
            tree.selection
              ? `${tree.selection.label} · référence comprise`
              : isAnalysisTree && totalHomologs + 1 > tree.leaf_count
                ? `les ${tree.leaf_count - 1} homologues les plus proches · référence comprise`
                : "référence comprise"
          }
        />
        <StatCard
          tone="amber"
          icon={<Layers size={15} />}
          label="Positions informatives"
          value={d ? `${d.informative_sites}` : "—"}
          hint={d ? `sur ${d.columns} colonnes${d.masked_columns ? ` (${d.masked_columns} masquées exclues)` : ""}` : "non calculé pour cet arbre"}
        />
        <StatCard
          tone="blue"
          icon={ml ? <Cpu size={15} /> : <Zap size={15} />}
          label="Méthode de reconstruction"
          value={ml ? "Maximum de vraisemblance" : "Neighbor-Joining"}
          hint={ml ? `IQ-TREE ${tree.ml?.version ?? ""} · modèle ${tree.model?.label ?? ""}` : `distances ${tree.model?.label ?? "Kimura"}`}
        />
        <StatCard
          tone="cyan"
          icon={<Sigma size={15} />}
          label="Réplicats"
          value={`${tree.bootstrap_replicates}`}
          hint={ml ? "UFBoot, et autant de SH-aLRT" : "bootstrap non paramétrique"}
        />
        <StatCard
          tone="emerald"
          icon={<ShieldCheck size={15} />}
          label="Branches à support ≥ 70 %"
          value={internal ? `${pct(at70 / internal)}` : "—"}
          hint={`${at70} sur ${internal} embranchements internes${ml ? " · seuil UFBoot recommandé : 95 %" : ""}`}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics séparés
// ---------------------------------------------------------------------------

function LevelBadge({ level }: { level: keyof typeof LEVEL_STYLE }) {
  const label = level === "correcte" ? "Correcte" : level === "prudence" ? "Prudence" : "Insuffisante";
  return <span className={`rounded border px-2 py-0.5 text-[12px] font-semibold ${LEVEL_STYLE[level]}`}>{label}</span>;
}

function DataQualityPanel({ tree }: { tree: PhyloTreeData }) {
  const quality = tree.data_quality!;
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-slate-900">1. Qualité des données</h3>
        <LevelBadge level={quality.level} />
      </div>
      <p className="text-[13px] text-slate-500">Les séquences et l’alignement contiennent-ils assez de signal ? Indépendant de la méthode de reconstruction.</p>
      <ul className="mt-2 space-y-2 text-[13px]">
        {quality.checks.map((c) => {
          const style = STATE_STYLE[c.status];
          return (
            <li key={c.id} className="grid grid-cols-[18px_1fr] gap-1.5">
              <span className={`mt-0.5 ${style.tone}`}>{style.icon}</span>
              <span>
                <b className="text-slate-900">{c.label}</b> : {c.value}
                <span className="block text-slate-600">{c.text}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RobustnessPanel({ tree }: { tree: PhyloTreeData }) {
  const r = tree.robustness!;
  const max = Math.max(...r.histogram.map((b) => b.count), 1);
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-slate-900">2. Robustesse phylogénétique</h3>
        <LevelBadge level={r.level} />
      </div>
      <p className="text-[13px] text-slate-500">Les embranchements obtenus résistent-ils au rééchantillonnage des colonnes ? {r.measure}.</p>
      <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-slate-500">Branches à support ≥ 70 %</dt>
          <dd className="text-[16px] font-semibold text-slate-900">
            {pct(r.fraction_70)} <span className="text-[13px] font-normal text-slate-500">({r.supported_70} / {r.internal_branches})</span>
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-slate-500">Au seuil recommandé ({r.recommended.label})</dt>
          <dd className="text-[16px] font-semibold text-slate-900">
            {pct(r.fraction_recommended)} <span className="text-[13px] font-normal text-slate-500">({r.robust} / {r.internal_branches})</span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[12px] font-semibold text-slate-600">Répartition des supports</p>
      <div className="mt-1 space-y-1">
        {r.histogram.map((b) => (
          <div key={b.label} className="grid grid-cols-[70px_1fr_32px] items-center gap-2 text-[12px]">
            <span className="text-slate-600">{b.label}</span>
            <span className="h-3 rounded bg-slate-100">
              <span className="block h-3 rounded bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${(b.count / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-slate-700">{b.count}</span>
          </div>
        ))}
      </div>
      {r.limits.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-slate-700">
          {r.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12px] text-slate-500">
        Des données de bonne qualité peuvent donner un arbre peu robuste (famille peu structurée), et inversement : les deux diagnostics se lisent
        séparément.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Construction d'un arbre
// ---------------------------------------------------------------------------

function TreeBuilder({
  result,
  tree,
  jobId,
  tools,
  onBuilt,
}: {
  result: ExplorerResult;
  tree: PhyloTreeData;
  jobId: string;
  tools: PhylogenyTools | null;
  onBuilt: (treeJobId: string) => void;
}) {
  const candidates = useMemo(() => {
    const homologs = new Map(result.homologs.map((h) => [h.accession, h]));
    return result.msa
      .map((m) => {
        const h = homologs.get(m.accession);
        return { id: m.accession, organism: h?.organism ?? null, identity: h?.identity ?? 0, coverage: h?.coverage ?? 0, group: h?.lineage?.phylum ?? null };
      })
      .sort((a, b) => b.identity - a.identity);
  }, [result]);
  const current = useMemo(() => new Set(tree.leaves.filter((l) => !l.is_query).map((l) => l.id)), [tree]);

  const [strategy, setStrategy] = useState<TreeStrategy>(tree.selection?.strategy ?? "closest");
  const [count, setCount] = useState(Math.min(tree.selection?.requested ?? 50, candidates.length, MAX_TREE_SELECTION));
  const [chosen, setChosen] = useState<Set<string>>(current);
  const [filter, setFilter] = useState("");
  const [method, setMethod] = useState<"nj" | "ml">(tree.method_id ?? "nj");
  const [model, setModel] = useState<TreeModel>((tree.method_id !== "ml" ? (tree.model?.id as TreeModel) : null) ?? "kimura");
  const [mlModel, setMlModel] = useState<"LG+G4" | "MFP">("LG+G4");
  const [replicates, setReplicates] = useState<100 | 200 | 500>(100);
  const [preview, setPreview] = useState<{ key: string; data: TreeSelection | null; error: string | null }>({ key: "", data: null, error: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auto = strategy !== "custom";
  const previewKey = auto ? `${strategy}:${count}` : "";
  useEffect(() => {
    if (!previewKey) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchTreeSelection(jobId, strategy as Exclude<TreeStrategy, "custom">, count)
        .then((data) => !cancelled && setPreview({ key: previewKey, data, error: null }))
        .catch((e) => !cancelled && setPreview({ key: previewKey, data: null, error: e instanceof Error ? e.message : String(e) }));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, strategy, count, previewKey]);

  const selection = auto && preview.key === previewKey ? preview.data : null;
  const selected = auto ? new Set(selection?.ids ?? []) : chosen;
  const size = selected.size;
  const invalid = size < MIN_HOMOLOGS || size > MAX_TREE_SELECTION;
  const mlAvailable = !!tools?.ml.available;
  const text = filter.trim().toLowerCase();
  const shown = candidates
    .filter((c) => !text || [c.id, c.organism].some((v) => v?.toLowerCase().includes(text)))
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)));

  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const build = async () => {
    setBusy(true);
    setError(null);
    const request: TreeRequest = { strategy, count, ids: auto ? undefined : [...chosen], method, model, ml_model: mlModel, replicates };
    try {
      const job = await submitTree(jobId, request);
      onBuilt(job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const strategies = tools?.strategies;
  return (
    <section className="card">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-[16px] font-semibold text-slate-900">
          <ListChecks size={16} />
          Construire un arbre
        </h3>
        <p className="text-[13px] text-slate-500">
          Choisissez comment sélectionner les séquences (la référence est toujours incluse), puis la méthode. L’arbre est construit à partir de
          l’alignement de cette analyse, sans recalculer le reste.
        </p>
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className="text-[13px] font-semibold text-slate-700">1. Stratégie de sélection des séquences</p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {STRATEGY_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setStrategy(s)}
              className={`rounded-lg border p-3 text-left text-[13px] ${strategy === s ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-200" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <p className="font-semibold text-slate-900">{strategies?.[s].label ?? s}</p>
              <p className="mt-0.5 leading-5 text-slate-600">{strategies?.[s].text}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {auto ? (
            <label className="flex items-center gap-1.5">
              Nombre d’homologues
              <input
                type="number"
                min={MIN_HOMOLOGS}
                max={Math.min(MAX_TREE_SELECTION, candidates.length)}
                value={count}
                onChange={(e) => setCount(Math.max(MIN_HOMOLOGS, Math.min(MAX_TREE_SELECTION, candidates.length, Number(e.target.value) || MIN_HOMOLOGS)))}
                className="w-20 rounded-xl border border-slate-300 px-2 py-1 tabular-nums"
              />
              <span className="text-slate-500">sur {candidates.length} disponibles</span>
            </label>
          ) : (
            <span className="text-slate-600">Cochez les homologues dans la liste ({MIN_HOMOLOGS} à {MAX_TREE_SELECTION}).</span>
          )}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer (espèce, identifiant…)"
            className="ml-auto w-56 rounded-xl border border-slate-300 px-2 py-1 outline-none focus:border-blue-500"
          />
        </div>

        {auto && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
            {preview.error ? (
              <span className="text-rose-700">Aperçu impossible : {preview.error}</span>
            ) : !selection ? (
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <Loader2 size={13} className="animate-spin" /> Calcul de la sélection…
              </span>
            ) : (
              <>
                <b>{selection.ids?.length ?? 0}</b> homologue(s) retenu(s) + la référence · {selection.species} espèce(s)
                {selection.identity_range && ` · identité avec la référence de ${pct(selection.identity_range[0])} à ${pct(selection.identity_range[1])}`}
                {selection.details.groups_covered != null &&
                  ` · ${selection.details.groups_covered} ${selection.details.rank_label?.toLowerCase() ?? "groupe"}(s) couvert(s) sur ${selection.details.groups_available}`}
                {selection.details.mean_nearest_distance != null &&
                  ` · chaque séquence ajoutée diffère en moyenne de ${pct(selection.details.mean_nearest_distance)} de la plus proche déjà retenue`}
                {!!selection.details.excluded_low_coverage && ` · ${selection.details.excluded_low_coverage} séquence(s) couvrant moins de 60 % de la référence écartée(s)`}
              </>
            )}
          </p>
        )}
      </div>

      <div className="max-h-64 overflow-auto border-y border-slate-100">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="w-8 px-3 py-1.5" />
              <th className="px-3 py-1.5 font-semibold">Identifiant</th>
              <th className="px-3 py-1.5 font-semibold">Espèce</th>
              <th className="px-3 py-1.5 font-semibold">Embranchement</th>
              <th className="px-3 py-1.5 text-right font-semibold">Identité</th>
              <th className="px-3 py-1.5 text-right font-semibold">Couverture</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${selected.has(c.id) ? "bg-blue-50/60" : ""}`}>
                <td className="px-3 py-1">
                  <input type="checkbox" checked={selected.has(c.id)} disabled={auto} onChange={() => toggle(c.id)} aria-label={`Inclure ${c.id}`} />
                </td>
                <td className="px-3 py-1 font-mono">{c.id}</td>
                <td className="max-w-[240px] truncate px-3 py-1 italic">{c.organism ?? "—"}</td>
                <td className="px-3 py-1 text-slate-600">{c.group ?? "—"}</td>
                <td className="px-3 py-1 text-right tabular-nums">{pct(c.identity)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{pct(c.coverage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className="text-[13px] font-semibold text-slate-700">2. Méthode de reconstruction</p>
        <div className="grid gap-2 lg:grid-cols-2">
          <div className={`rounded-lg border p-3 text-[13px] ${method === "nj" ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-200" : "border-slate-200"}`}>
            <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-900">
              <input type="radio" checked={method === "nj"} onChange={() => setMethod("nj")} />
              <Zap size={14} /> Neighbor-Joining — rapide (quelques secondes)
            </label>
            <p className="mt-1 text-slate-600">Méthode de distances. Utile pour explorer et comparer des sélections.</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5">
                Distance
                <select value={model} onChange={(e) => setModel(e.target.value as TreeModel)} disabled={method !== "nj"} className="rounded-xl border border-slate-300 px-2 py-1">
                  {DISTANCE_MODELS.map((m) => (
                    <option key={m.value} value={m.value} title={m.text}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                Bootstrap
                <select value={replicates} onChange={(e) => setReplicates(Number(e.target.value) as 100 | 200 | 500)} disabled={method !== "nj"} className="rounded-xl border border-slate-300 px-2 py-1">
                  {[100, 200, 500].map((r) => (
                    <option key={r} value={r}>
                      {r} réplicats
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div
            className={`rounded-lg border p-3 text-[13px] ${
              !mlAvailable ? "border-slate-200 bg-slate-50 opacity-80" : method === "ml" ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-200" : "border-slate-200"
            }`}
          >
            <label className={`flex items-center gap-2 font-semibold text-slate-900 ${mlAvailable ? "cursor-pointer" : "cursor-not-allowed"}`}>
              <input type="radio" checked={method === "ml"} disabled={!mlAvailable} onChange={() => setMethod("ml")} />
              <Cpu size={14} /> Maximum de vraisemblance (IQ-TREE) — rigoureux (minutes)
            </label>
            {mlAvailable ? (
              <>
                <p className="mt-1 text-slate-600">
                  IQ-TREE {tools?.ml.version} · supports UFBoot ({tools?.ml.ufboot_replicates}) et SH-aLRT ({tools?.ml.alrt_replicates}). Recommandé pour
                  une publication.
                </p>
                <label className="mt-2 flex items-center gap-1.5">
                  Modèle
                  <select value={mlModel} onChange={(e) => setMlModel(e.target.value as "LG+G4" | "MFP")} disabled={method !== "ml"} className="rounded-xl border border-slate-300 px-2 py-1">
                    {Object.entries(tools?.ml.models ?? {}).map(([value, m]) => (
                      <option key={value} value={value} title={m.text}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-1 text-[12px] text-slate-500">{tools?.ml.models[mlModel]?.text}</p>
              </>
            ) : (
              <p className="mt-1 text-slate-600">{tools ? tools.ml.help : "Vérification de la disponibilité d’IQ-TREE…"}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className={`font-semibold ${invalid ? "text-rose-700" : "text-slate-700"}`}>
            {size} homologue(s) + la référence = {size + 1} séquences
          </span>
          {size > 0 && size < 7 && <span className="text-amber-800">Moins de 8 séquences : topologie très incertaine.</span>}
          <button
            onClick={build}
            disabled={invalid || busy || (auto && !selection) || (method === "ml" && !mlAvailable)}
            className="btn-primary ml-auto gap-1.5 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Construire l’arbre
          </button>
        </div>
        {error && <p className="text-[13px] text-rose-700">Arbre impossible : {error}</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Méthode
// ---------------------------------------------------------------------------

function Method({ tree }: { tree: PhyloTreeData }) {
  const d = tree.diagnostics;
  const ml = tree.method_id === "ml" ? tree.ml : null;
  const items: [string, React.ReactNode][] = [
    ["Sélection des séquences", tree.selection ? `${tree.selection.label} : ${tree.selection.text}` : "Les homologues les plus proches de la référence (arbre de l’analyse)."],
    ["Reconstruction", tree.reconstruction ?? "Neighbor-Joining (Saitou & Nei, 1987)"],
    [
      ml ? "Modèle d’évolution" : "Modèle de distance",
      tree.model ? (
        <>
          {tree.model.label}
          {tree.model.formula && (
            <>
              {" "}
              : <span className="font-mono">{tree.model.formula}</span>, p étant la proportion d’acides aminés différents sur les positions alignées
            </>
          )}
          . {tree.model.text}
        </>
      ) : (
        "Kimura (1983) pour les protéines"
      ),
    ],
    ["Racine", tree.rooting ?? "Point médian du plus long chemin entre deux séquences"],
    [
      "Support des branches",
      `${tree.support?.method ?? "Bootstrap (Felsenstein, 1985)"} : ${tree.bootstrap_replicates} réplicats${ml ? " pour chaque mesure ; dans l’arbre, les valeurs affichées sont celles d’UFBoot" : " où les colonnes de l’alignement sont tirées avec remise"}.`,
    ],
  ];
  if (ml) {
    items.push([
      "Exécution IQ-TREE",
      <>
        {ml.log_likelihood != null && `Log-vraisemblance ${ml.log_likelihood} · `}durée {ml.runtime} s · commande : <span className="break-all font-mono text-[12px]">{ml.command}</span>
      </>,
    ]);
  }
  if (d) {
    items.push([
      "Alignement utilisé",
      `${d.columns} colonnes${d.masked_columns ? ` (${d.masked_columns} masquées par le contrôle qualité exclues)` : ""}, ${d.informative_sites} positions informatives, recouvrement moyen des paires ${
        d.mean_overlap != null ? Math.round(d.mean_overlap * 100) : "—"
      } %.`,
    ]);
  }
  return (
    <section className="card p-4 text-[14px] leading-6 text-slate-600">
      <h3 className="mb-2 text-[16px] font-semibold text-slate-900">Méthode</h3>
      <dl className="grid gap-x-4 gap-y-2 md:grid-cols-[190px_1fr]">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold text-slate-800">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
