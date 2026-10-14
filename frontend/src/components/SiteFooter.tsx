import Link from "next/link";
import { Layers3 } from "lucide-react";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Analyser",
    links: [
      { href: "/search", label: "Recherche UniProt" },
      { href: "/explorateur", label: "Explorateur évolutif" },
      { href: "/comparaison", label: "Comparaison" },
    ],
  },
  {
    title: "Suivre",
    links: [
      { href: "/analyses", label: "Analyses et rapports" },
      { href: "/projets", label: "Mes projets" },
      { href: "/#pipeline", label: "Pipeline" },
    ],
  },
];

const SOURCES = ["UniProtKB", "RCSB PDB", "AlphaFold DB", "DeepTMHMM", "OPM", "IQ-TREE"];

export default function SiteFooter() {
  return (
    <footer className="relative mt-auto overflow-hidden bg-[#0f0c29] text-[14px] text-indigo-200">
      <div className="h-1 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-400" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(99,102,241,0.25),transparent_40%),radial-gradient(circle_at_95%_100%,rgba(6,182,212,0.18),transparent_40%)]"
      />
      <div className="relative grid w-full gap-8 px-4 py-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr] lg:px-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 p-2 text-white shadow-lg shadow-indigo-900/40">
              <Layers3 size={18} />
            </span>
            <p className="text-[17px] font-extrabold tracking-tight text-white">
              MemProt<span className="gradient-text-light">Scope</span>
            </p>
          </div>
          <p className="mt-3 max-w-sm leading-6 text-indigo-200/80">
            Plateforme d’analyse structurale, évolutive et fonctionnelle des protéines membranaires.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-white">{col.title}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="transition hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-white">Données et outils</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SOURCES.map((s) => (
              <span key={s} className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[12.5px] text-indigo-100">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="relative border-t border-white/10 px-4 py-3 text-[12.5px] text-indigo-300/70 lg:px-6">
        © {new Date().getFullYear()} MemProtScope · Les prédictions affichées sont des estimations bioinformatiques, à confirmer expérimentalement.
      </div>
    </footer>
  );
}
