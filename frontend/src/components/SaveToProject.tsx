"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookmarkPlus, Check, Loader2, X } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { projectsApi, type Project, type SavedAnalysis } from "@/lib/auth";

type Props = {
  kind: SavedAnalysis["kind"];
  title: string;
  payload: Record<string, unknown>;
  /** Apparence : bouton clair (fond blanc) ou sur bandeau sombre. */
  variant?: "light" | "dark";
};

const NEW_PROJECT = "__nouveau__";

export default function SaveToProject({ kind, title, payload, variant = "light" }: Props) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Project | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setSaved(null);
    setError(null);
    projectsApi
      .list()
      .then((list) => {
        setProjects(list);
        setProjectId(list[0]?.id ?? NEW_PROJECT);
      })
      .catch((e) => setError(e.message));
  }, [open, user]);

  // Fermeture au clic extérieur et avec Échap
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let project = projects?.find((p) => p.id === projectId) ?? null;
      if (projectId === NEW_PROJECT) {
        if (!newName.trim()) throw new Error("Donnez un nom au nouveau projet.");
        project = await projectsApi.create(newName.trim());
      }
      if (!project) throw new Error("Choisissez un projet.");
      await projectsApi.saveAnalysis(project.id, { kind, title, payload, notes });
      setSaved(project);
      setNotes("");
      setNewName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const buttonClass =
    variant === "dark"
      ? "border border-white/25 bg-white/10 text-white hover:bg-white/20"
      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[14px] font-medium ${buttonClass}`}
      >
        <BookmarkPlus size={15} />
        Enregistrer dans un projet
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[340px] rounded-lg border border-slate-200 bg-white p-4 text-left text-slate-900 shadow-xl">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-[15px] font-semibold">Enregistrer l’analyse</p>
              <p className="truncate text-[13px] text-slate-500" title={title}>
                {title}
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Fermer">
              <X size={16} />
            </button>
          </div>

          {!user ? (
            <div className="space-y-2 text-[14px] text-slate-600">
              <p>Connectez-vous pour regrouper vos analyses dans des projets.</p>
              <Link
                href={`/connexion?next=${encodeURIComponent(pathname + (typeof window !== "undefined" ? window.location.search : ""))}`}
                className="inline-flex w-full items-center justify-center rounded-md bg-[#0f4c81] px-3 py-2 font-semibold text-white hover:bg-[#0c3d68]"
              >
                Se connecter
              </Link>
            </div>
          ) : saved ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-[14px] text-emerald-800">
                <Check size={16} />
                Enregistrée dans « {saved.name} »
              </p>
              <Link
                href={`/projets/${saved.id}`}
                className="block text-center text-[14px] font-medium text-[#0f4c81] hover:underline"
              >
                Ouvrir le projet
              </Link>
            </div>
          ) : projects === null && !error ? (
            <div className="flex items-center gap-2 py-3 text-[14px] text-slate-500">
              <Loader2 size={15} className="animate-spin" />
              Chargement des projets…
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-slate-700">Projet</span>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[14px]"
                >
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.analysis_count})
                    </option>
                  ))}
                  <option value={NEW_PROJECT}>+ Nouveau projet…</option>
                </select>
              </label>
              {projectId === NEW_PROJECT && (
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nom du nouveau projet"
                  maxLength={120}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[14px] outline-none focus:border-[#0f4c81]"
                />
              )}
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-slate-700">Note (facultatif)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={5000}
                  className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-[14px] outline-none focus:border-[#0f4c81]"
                />
              </label>
              {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
              <button
                onClick={save}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0f4c81] px-3 py-2 text-[14px] font-semibold text-white hover:bg-[#0c3d68] disabled:opacity-60"
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                Enregistrer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
