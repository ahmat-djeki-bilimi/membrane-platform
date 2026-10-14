"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, LogIn, LogOut, UserRound } from "lucide-react";
import { useAuth } from "./AuthProvider";

export default function UserMenu() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  if (loading) return <span className="h-8 w-24 animate-pulse rounded-xl bg-slate-100" />;

  if (!user) {
    return (
      <Link
        href="/connexion"
        className="btn-primary px-3.5 py-1.5 text-[14px]"
      >
        <LogIn size={15} />
        Connexion
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Link
        href="/projets"
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
      >
        <FolderOpen size={15} />
        Mes projets
      </Link>
      <span
        className="hidden items-center gap-1.5 px-2 text-[13px] text-slate-500 lg:inline-flex"
        title={user.email}
      >
        <UserRound size={15} />
        {user.name || user.email}
      </span>
      <button
        onClick={async () => {
          await logout();
          router.push("/");
        }}
        className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-[13px] text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        title="Se déconnecter"
      >
        <LogOut size={15} />
        <span className="sr-only">Se déconnecter</span>
      </button>
    </div>
  );
}
