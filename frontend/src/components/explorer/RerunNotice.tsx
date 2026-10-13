"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

/**
 * Analyse calculée par une version précédente de l'Explorateur : bouton qui la
 * relance avec les mêmes séquences et les mêmes réglages.
 */
export default function RerunNotice({
  title,
  text = "Recalculez-la avec les mêmes séquences et les mêmes réglages : tous les onglets seront mis à jour.",
  button = "Recalculer l’analyse",
  onRerun,
  compact = false,
}: {
  title: string;
  text?: string;
  button?: string;
  onRerun?: () => Promise<void>;
  compact?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!onRerun) return;
    setRunning(true);
    setError(null);
    try {
      await onRerun();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de joindre le serveur.");
      setRunning(false);
    }
  };

  const action = onRerun ? (
    <button
      disabled={running}
      onClick={run}
      className="inline-flex shrink-0 items-center gap-2 rounded-md bg-[#0f4c81] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#0b3a63] disabled:opacity-50"
    >
      {running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
      {button}
    </button>
  ) : null;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[14px] text-amber-900">
        <span className="min-w-0 flex-1">
          <b>{title}</b> {text}
        </span>
        {action}
        {error && <span className="w-full text-rose-700">{error}</span>}
      </div>
    );
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <p className="text-[15px] font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-[14px] text-slate-600">{text}</p>
      {action && <div className="mt-3">{action}</div>}
      {error && <p className="mt-2 text-[14px] text-rose-700">{error}</p>}
    </section>
  );
}
