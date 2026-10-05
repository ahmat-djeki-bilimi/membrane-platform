import Link from "next/link";
import { Layers3 } from "lucide-react";
import UserMenu from "./UserMenu";

type Section = "home" | "search" | "projects";

const LINKS: { href: string; label: string; section?: Section }[] = [
  { href: "/", label: "Accueil", section: "home" },
  { href: "/search", label: "Recherche", section: "search" },
  { href: "/#pipeline", label: "Pipeline" },
  { href: "/#analyses", label: "Analyses" },
  { href: "/#structures", label: "Structures" },
];

export default function SiteHeader({ active }: { active?: Section }) {
  return (
    <header className="sticky top-0 z-40 h-[var(--site-header-h)] border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex h-full w-full items-center justify-between px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="rounded-lg bg-gradient-to-br from-[#0f4c81] to-cyan-600 p-2 text-white shadow-sm">
            <Layers3 size={20} />
          </div>
          <div>
            <p className="text-[17px] font-bold text-slate-900">MemProtScope</p>
            <p className="text-[13px] text-slate-500">
              Analyse structurale des protéines membranaires
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-3">
        <nav className="hidden items-center gap-1 text-[15px] font-medium md:flex">
          {LINKS.map((link) => {
            const isActive = link.section !== undefined && link.section === active;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 transition ${
                  isActive
                    ? "bg-blue-50 text-[#0f4c81]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
    </header>
  );
}
