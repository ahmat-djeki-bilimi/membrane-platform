import Link from "next/link";
import { Layers3 } from "lucide-react";
import UserMenu from "./UserMenu";

type Section = "home" | "search" | "explorer" | "comparison" | "analyses" | "projects";

const LINKS: { href: string; label: string; section?: Section }[] = [
  { href: "/", label: "Accueil", section: "home" },
  { href: "/search", label: "Recherche", section: "search" },
  { href: "/explorateur", label: "Explorateur", section: "explorer" },
  { href: "/comparaison", label: "Comparaison", section: "comparison" },
  { href: "/#pipeline", label: "Pipeline" },
  { href: "/analyses", label: "Analyses", section: "analyses" },
  { href: "/#structures", label: "Structures" },
];

export default function SiteHeader({ active }: { active?: Section }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/75 shadow-[0_1px_12px_-6px_rgba(30,27,75,0.15)] backdrop-blur-xl backdrop-saturate-150">
      <div className="flex h-16 w-full items-center justify-between gap-4 px-4 lg:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-3">
          <div className="relative rounded-xl bg-gradient-to-br from-indigo-600 via-violet-600 to-cyan-500 p-2 text-white shadow-lg shadow-indigo-500/30 transition group-hover:rotate-[-4deg] group-hover:scale-105">
            <Layers3 size={20} />
          </div>
          <div className="leading-tight">
            <p className="text-[17px] font-extrabold tracking-tight text-slate-900">
              MemProt<span className="gradient-text">Scope</span>
            </p>
            <p className="hidden text-[12px] font-medium text-slate-500 sm:block">
              Analyse structurale des protéines membranaires
            </p>
          </div>
        </Link>

        <div className="flex min-w-0 items-center gap-3">
          <nav className="hidden items-center gap-0.5 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-1 text-[14px] font-semibold lg:flex">
            {LINKS.map((link) => {
              const isActive = link.section !== undefined && link.section === active;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-xl px-3 py-1.5 transition ${
                    isActive
                      ? "tab-active"
                      : "text-slate-600 hover:bg-white hover:text-indigo-700 hover:shadow-sm"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <UserMenu />
        </div>
      </div>
      <nav className="flex h-10 items-center gap-1 overflow-x-auto border-t border-slate-200/70 px-3 text-[13px] font-semibold lg:hidden">
        {LINKS.map((link) => {
          const isActive = link.section !== undefined && link.section === active;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 rounded-lg px-2.5 py-1 ${isActive ? "tab-active" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
