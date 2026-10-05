"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "./AuthProvider";

/** Redirige vers la connexion si aucun utilisateur n'est connecté. */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/connexion?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, pathname, router]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 py-16 text-[15px] text-slate-500">
        <Loader2 size={18} className="animate-spin" />
        Vérification de la session…
      </div>
    );
  }
  return <>{children}</>;
}
