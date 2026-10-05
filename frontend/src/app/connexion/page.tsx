"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, LogIn, UserPlus } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { useAuth } from "@/components/AuthProvider";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

export default function ConnexionPage() {
  return (
    <Suspense fallback={null}>
      <ConnexionContent />
    </Suspense>
  );
}

function ConnexionContent() {
  const router = useRouter();
  const params = useSearchParams();
  // Retour à la page d'origine ; seuls les chemins internes sont acceptés
  const rawNext = params.get("next") || "/projets";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/projets";

  const { user, loading, login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, name);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader />
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative px-4 py-6 lg:px-6">
          <h1 className="text-[28px] font-bold text-white">Votre espace MemProtScope</h1>
          <p className="mt-1 text-[15px] text-blue-100">
            Regroupez vos analyses dans des projets et retrouvez-les à tout moment.
          </p>
        </div>
      </section>

      <main className="flex flex-1 items-start justify-center px-4 py-8">
        <div className="w-full max-w-[440px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="tablist" className="grid grid-cols-2 border-b border-slate-200">
            {(
              [
                ["login", "Connexion", <LogIn key="l" size={16} />],
                ["register", "Créer un compte", <UserPlus key="r" size={16} />],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={mode === key}
                onClick={() => {
                  setMode(key);
                  setError(null);
                }}
                className={`inline-flex items-center justify-center gap-2 px-4 py-3 text-[15px] font-semibold transition ${
                  mode === key
                    ? "border-b-2 border-[#0f4c81] text-[#0f4c81]"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4 p-6">
            {mode === "register" && (
              <Field label="Nom (facultatif)">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={120}
                  className={inputClass}
                />
              </Field>
            )}
            <Field label="Adresse e-mail">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={inputClass}
              />
            </Field>
            <Field label="Mot de passe" hint={mode === "register" ? "8 caractères minimum." : undefined}>
              <input
                type="password"
                required
                minLength={mode === "register" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className={inputClass}
              />
            </Field>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-[14px] text-rose-700">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0f4c81] px-4 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0c3d68] disabled:opacity-60"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {mode === "login" ? "Se connecter" : "Créer mon compte"}
            </button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[15px] outline-none focus:border-[#0f4c81] focus:ring-2 focus:ring-blue-100";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[14px] font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-slate-500">{hint}</span>}
    </label>
  );
}
