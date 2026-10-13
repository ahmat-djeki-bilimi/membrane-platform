"use client";

import { useMemo, useState } from "react";
import { GitBranch, Layers, ShieldCheck, Users } from "lucide-react";
import { StatCard } from "@/components/ui";
import PhyloTree from "@/components/evolution/PhyloTree";
import RerunNotice from "./RerunNotice";
import type { PhyloNode } from "@/lib/conservation";
import type { ExplorerResult } from "@/lib/explorer";

/** Arbre phylogénétique de la référence et de ses homologues les plus proches. */
export default function PhylogenyTab({
  result,
  fileBase,
  onRerun,
}: {
  result: ExplorerResult;
  fileBase: string;
  /** Relance la même analyse avec la méthode actuelle (analyses antérieures à l'arbre). */
  onRerun?: () => Promise<void>;
}) {
  const tree = result.tree ?? null;
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);

  const supports = useMemo(() => {
    const values: number[] = [];
    const walk = (node: PhyloNode) => {
      if (node.support !== undefined && node.support !== null) values.push(node.support);
      node.children?.forEach(walk);
    };
    if (tree) walk(tree.root);
    return values;
  }, [tree]);

  if (!tree) {
    if (result.version < 2) {
      return (
        <RerunNotice
          title="Cette analyse a été lancée avant l’ajout de l’arbre phylogénétique."
          button="Recalculer avec l’arbre"
          onRerun={onRerun}
        />
      );
    }
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-[15px] text-slate-700">
        Pas d’arbre phylogénétique pour cette analyse : il faut au moins 4 séquences.
      </p>
    );
  }

  const identities = tree.leaves.filter((l) => !l.is_query && l.identity !== null).map((l) => l.identity!);
  const lowest = identities.length ? Math.min(...identities) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          tone="violet"
          icon={<GitBranch size={15} />}
          label="Séquences"
          value={`${tree.leaf_count}`}
          hint={result.input.kept + 1 > tree.leaf_count ? `les ${tree.leaf_count - 1} homologues les plus proches` : "toute la famille"}
        />
        <StatCard
          tone="blue"
          icon={<Users size={15} />}
          label={tree.group_rank_label ? `Groupes (${tree.group_rank_label.toLowerCase()})` : "Groupes"}
          value={`${tree.groups.length}`}
          hint={tree.groups.slice(0, 3).map((g) => g.name).join(", ") || "taxonomie inconnue"}
        />
        <StatCard
          tone="emerald"
          icon={<ShieldCheck size={15} />}
          label="Branches robustes"
          value={supports.length ? `${supports.filter((s) => s >= 0.7).length} / ${supports.length}` : "—"}
          hint={`bootstrap ≥ 70 % sur ${tree.bootstrap_replicates} réplicats`}
        />
        <StatCard
          tone="amber"
          icon={<Layers size={15} />}
          label="Identité la plus faible"
          value={lowest !== null ? `${Math.round(lowest * 100)} %` : "—"}
          hint="homologue le plus éloigné de la référence"
        />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <PhyloTree tree={tree} selectedId={selectedSpecies} onSelect={setSelectedSpecies} fileBase={fileBase} maxHeight={900} />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-[14px] leading-6 text-slate-600">
        <h3 className="mb-1 text-[16px] font-semibold text-slate-900">Méthode et lecture</h3>
        <p>
          Distances entre séquences : proportion d’acides aminés différents sur les positions alignées, corrigée par la
          formule de Kimura (1983). Arbre par Neighbor-Joining (Saitou &amp; Nei, 1987), raciné au milieu du plus long
          chemin entre deux séquences : cette racine est une approximation, pas forcément l’ancêtre réel. Le bootstrap
          (Felsenstein, 1985) rééchantillonne {tree.bootstrap_replicates} fois les colonnes de l’alignement : un
          embranchement retrouvé dans au moins 70 % des réplicats est considéré comme robuste. Une espèce mal placée peut
          signaler une duplication (paralogue) ou une séquence incomplète. L’alignement peut être affiché dans l’ordre de
          l’arbre dans l’onglet Conservation.
        </p>
      </section>
    </div>
  );
}
