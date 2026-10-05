"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen, FolderPlus, Loader2, Plus } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import RequireAuth from "@/components/RequireAuth";
import { useAuth } from "@/components/AuthProvider";
import { Alert } from "@/components/ui";
import { projectsApi, type Project } from "@/lib/auth";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

export default function ProjetsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="projects" />
      <RequireAuth>
        <ProjectsContent />
      </RequireAuth>
      <SiteFooter />
    </div>
  );
}

function ProjectsContent() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch((e) => setError(e.message));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const project = await projectsApi.create(name.trim(), description.trim());
      setProjects((list) => [project, ...(list ?? [])]);
      setName("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative px-4 py-6 lg:px-6">
          <h1 className="text-[28px] font-bold text-white">Mes projets</h1>
          <p className="mt-1 text-[15px] text-blue-100">
            {user?.name ? `${user.name} · ` : ""}
            {user?.email}
          </p>
        </div>
      </section>

      <main className="grid w-full flex-1 items-start gap-4 px-4 py-4 lg:grid-cols-[1fr_380px] lg:px-6">
        <section className="space-y-3">
          {error && (
            <Alert tone="rose" title="Erreur">
              {error}
            </Alert>
          )}
          {projects === null ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-6 text-[15px] text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Chargement des projets…
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
              <FolderOpen size={32} className="mx-auto text-slate-300" />
              <p className="mt-2 text-[16px] font-semibold text-slate-800">Aucun projet pour l’instant</p>
              <p className="text-[14px] text-slate-500">
                Créez un projet, puis enregistrez-y des analyses depuis les pages Recherche et
                Structures.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projets/${p.id}`}
                    className="relative block overflow-hidden rounded-lg border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm"
                  >
                    <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 to-cyan-500" />
                    <p className="text-[17px] font-semibold text-slate-900">{p.name}</p>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-[14px] text-slate-600">{p.description}</p>
                    )}
                    <p className="mt-3 text-[13px] text-slate-500">
                      {p.analysis_count} analyse{p.analysis_count > 1 ? "s" : ""} · modifié le{" "}
                      {new Date(p.updated_at || p.created_at).toLocaleDateString("fr-FR")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={create} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-slate-900">
            <FolderPlus size={18} className="text-[#0f4c81]" />
            Nouveau projet
          </h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du projet, ex. Canaux potassiques"
            maxLength={120}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] outline-none focus:border-[#0f4c81] focus:ring-2 focus:ring-blue-100"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (facultatif)"
            rows={3}
            maxLength={5000}
            className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-[15px] outline-none focus:border-[#0f4c81] focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0f4c81] px-4 py-2 text-[15px] font-semibold text-white hover:bg-[#0c3d68] disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Créer le projet
          </button>
        </form>
      </main>
    </>
  );
}
