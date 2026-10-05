"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Boxes, ChevronRight, Dna, FileText, Loader2, Pencil, Trash2 } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import RequireAuth from "@/components/RequireAuth";
import { SEQUENCE_STORAGE_PREFIX } from "@/components/SearchForm";
import { Alert } from "@/components/ui";
import { projectsApi, type Project, type SavedAnalysis } from "@/lib/auth";
import { hashSequence } from "@/lib/sequence";
import { HERO_BG, HERO_GLOW } from "@/lib/theme";

const KIND = {
  accession: { label: "Analyse de séquence", icon: <Dna size={16} />, color: "bg-blue-600" },
  sequence: { label: "Séquence utilisateur", icon: <FileText size={16} />, color: "bg-rose-500" },
  structure: { label: "Structure", icon: <Boxes size={16} />, color: "bg-violet-600" },
} as const;

export default function ProjectPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="projects" />
      <RequireAuth>
        <ProjectContent />
      </RequireAuth>
      <SiteFooter />
    </div>
  );
}

function ProjectContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    projectsApi
      .get(id)
      .then((p) => {
        setProject(p);
        setName(p.name);
        setDescription(p.description);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const save = async () => {
    try {
      const updated = await projectsApi.update(id, name.trim(), description.trim());
      setProject((p) => (p ? { ...p, ...updated, analyses: p.analyses } : p));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible.");
    }
  };

  const removeProject = async () => {
    await projectsApi.remove(id);
    router.replace("/projets");
  };

  const removeAnalysis = async (analysis: SavedAnalysis) => {
    await projectsApi.removeAnalysis(id, analysis.id);
    setProject((p) => (p ? { ...p, analyses: p.analyses?.filter((a) => a.id !== analysis.id) } : p));
  };

  const open = (analysis: SavedAnalysis) => {
    const payload = analysis.payload as Record<string, string>;
    if (analysis.kind === "accession") router.push(`/search?q=${payload.accession}`);
    else if (analysis.kind === "structure")
      router.push(`/structures/${payload.accession}${payload.pdb_id ? `?pdb=${payload.pdb_id}` : ""}`);
    else {
      // Séquence enregistrée : remise en session puis ouverture de l'analyse
      const key = hashSequence(payload.sequence);
      try {
        sessionStorage.setItem(
          SEQUENCE_STORAGE_PREFIX + key,
          JSON.stringify({ header: payload.header ?? null, sequence: payload.sequence, warnings: [] })
        );
      } catch {
        // Sans stockage de session, la page d'analyse le signalera
      }
      router.push(`/search?seq=${key}`);
    }
  };

  if (error && !project) {
    return (
      <main className="flex-1 px-4 py-6 lg:px-6">
        <Alert tone="rose" title="Projet indisponible">
          {error}
        </Alert>
      </main>
    );
  }
  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 py-16 text-[15px] text-slate-500">
        <Loader2 size={18} className="animate-spin" />
        Chargement du projet…
      </div>
    );
  }

  const analyses = project.analyses ?? [];

  return (
    <>
      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative px-4 py-6 lg:px-6">
          <nav className="flex items-center gap-1 text-[13px] text-blue-200">
            <Link href="/projets" className="hover:text-white">
              Mes projets
            </Link>
            <ChevronRight size={13} />
            <span className="text-white">{project.name}</span>
          </nav>
          {editing ? (
            <div className="mt-2 max-w-[640px] space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className="w-full rounded-md px-3 py-2 text-[18px] font-semibold text-slate-900 outline-none"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={5000}
                placeholder="Description"
                className="w-full rounded-md px-3 py-2 text-[15px] text-slate-900 outline-none"
              />
              <div className="flex gap-2">
                <button onClick={save} disabled={!name.trim()} className="rounded-md bg-white px-3 py-1.5 text-[14px] font-semibold text-[#0f4c81] disabled:opacity-50">
                  Enregistrer
                </button>
                <button onClick={() => setEditing(false)} className="rounded-md px-3 py-1.5 text-[14px] text-white hover:bg-white/10">
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-[28px] font-bold text-white">{project.name}</h1>
                {project.description && <p className="max-w-[80ch] text-[15px] text-blue-100">{project.description}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] text-white hover:bg-white/20"
                >
                  <Pencil size={14} />
                  Modifier
                </button>
                {confirmDelete ? (
                  <span className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-3 py-2 text-[14px] text-white">
                    Supprimer le projet et ses analyses ?
                    <button onClick={removeProject} className="font-semibold underline">
                      Oui
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="underline">
                      Non
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-[14px] text-white hover:bg-rose-600"
                  >
                    <Trash2 size={14} />
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <main className="w-full flex-1 space-y-3 px-4 py-4 lg:px-6">
        <h2 className="text-[17px] font-semibold text-slate-900">
          Analyses enregistrées ({analyses.length})
        </h2>
        {analyses.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-[15px] text-slate-600">
            Aucune analyse. Utilisez le bouton « Enregistrer dans un projet » sur les pages
            Recherche et Structures.
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {analyses.map((a) => {
              const kind = KIND[a.kind];
              const payload = a.payload as Record<string, string | number>;
              return (
                <li key={a.id} className="flex flex-col rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <span className={`rounded-md p-2 text-white ${kind.color}`}>{kind.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">{kind.label}</p>
                      <p className="truncate text-[16px] font-semibold text-slate-900" title={a.title}>
                        {a.title}
                      </p>
                      <p className="font-mono text-[13px] text-slate-500">
                        {[payload.accession, payload.pdb_id, payload.length ? `${payload.length} aa` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  {a.notes && <p className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-[14px] text-slate-700">{a.notes}</p>}
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <span className="text-[13px] text-slate-400">
                      {new Date(a.created_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => removeAnalysis(a)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Retirer du projet"
                      >
                        <Trash2 size={15} />
                      </button>
                      <button
                        onClick={() => open(a)}
                        className="inline-flex items-center gap-1 rounded-md bg-[#0f4c81] px-2.5 py-1 text-[13px] font-semibold text-white hover:bg-[#0c3d68]"
                      >
                        Ouvrir
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
