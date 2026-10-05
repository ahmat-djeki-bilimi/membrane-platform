"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, LogIn, LogOut, UserRound } from "lucide-react";
import { useAuth } from "./AuthProvider";

export default function UserMenu() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  if (loading) return <span className="h-8 w-24 animate-pulse rounded-md bg-slate-100" />;

  if (!user) {
    return (
      <Link
        href="/connexion"
        className="inline-flex items-center gap-1.5 rounded-md bg-[#0f4c81] px-3 py-1.5 text-[14px] font-semibold text-white hover:bg-[#0c3d68]"
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
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-[14px] font-medium text-slate-700 hover:bg-slate-50"
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
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        title="Se déconnecter"
      >
        <LogOut size={15} />
        <span className="sr-only">Se déconnecter</span>
      </button>
    </div>
  );
}
