// Suivi des calculs en file (route /api/jobs/{id}).

import { useEffect, useState } from "react";
import { API_BASE } from "./api";

export type JobStatus = "idle" | "queued" | "running" | "succeeded" | "failed";

export type Job<T> = { id: string; status: string; result?: T | null; error?: string | null };

export type JobState<T, J extends Job<T> = Job<T>> = {
  status: JobStatus;
  result: T | null;
  error: string | null;
  /** Première réponse du serveur (champs propres à chaque route). */
  job: J | null;
};

const POLL_DELAY = 3000;

/**
 * Lance un calcul (`start`) puis réinterroge le serveur jusqu'à son résultat.
 * Le calcul est relancé quand `key` change ; `start` nul remet à zéro.
 */
export function useJob<T, J extends Job<T> = Job<T>>(start: (() => Promise<J>) | null, key: string): JobState<T, J> {
  const [state, setState] = useState<JobState<T, J>>({ status: "idle", result: null, error: null, job: null });

  useEffect(() => {
    if (!start) {
      setState({ status: "idle", result: null, error: null, job: null });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first: J | null = null;
    setState({ status: "queued", result: null, error: null, job: null });

    const handle = (job: Job<T>) => {
      if (cancelled) return;
      if (job.status === "succeeded") setState({ status: "succeeded", result: job.result ?? null, error: null, job: first });
      else if (job.status === "failed")
        setState({ status: "failed", result: null, error: job.error || "Calcul impossible.", job: first });
      else {
        setState({ status: job.status as JobStatus, result: null, error: null, job: first });
        timer = setTimeout(() => {
          fetch(`${API_BASE}/api/jobs/${job.id}`)
            .then((r) => r.json())
            .then(handle)
            .catch(fail);
        }, POLL_DELAY);
      }
    };
    const fail = (e?: unknown) =>
      !cancelled &&
      setState({
        status: "failed",
        result: null,
        error: e instanceof Error && e.message ? e.message : "Impossible de joindre le serveur.",
        job: first,
      });

    start()
      .then((job) => {
        first = job;
        handle(job);
      })
      .catch(fail);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/** Réponse JSON d'une route de soumission ; erreur explicite sinon. */
export async function readJob(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `Erreur ${response.status}`);
  return data;
}
