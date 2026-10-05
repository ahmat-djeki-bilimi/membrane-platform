"use client";

import { useState } from "react";
import { AA_CLASSES, type Composition } from "../../lib/sequence";

// Une seule série : les classes sont indiquées par le regroupement et les
// étiquettes, pas par la couleur.
export default function CompositionChart({ composition }: { composition: Composition }) {
  const [hover, setHover] = useState<string | null>(null);
  const byAA = Object.fromEntries(composition.map((c) => [c.aa, c]));
  const max = Math.max(...composition.map((c) => c.percent), 1);
  const hovered = hover ? byAA[hover] : null;

  return (
    <div>
      <div className="mb-2 h-5 text-[14px] text-slate-600" aria-live="polite">
        {hovered ? (
          <>
            <span className="font-mono font-semibold text-slate-900">{hovered.aa}</span> ·{" "}
            {hovered.count} résidu{hovered.count > 1 ? "s" : ""} ·{" "}
            <span className="font-semibold text-slate-900">
              {hovered.percent.toFixed(1).replace(".", ",")} %
            </span>
          </>
        ) : (
          "Survolez une barre pour voir la valeur."
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[460px] items-end gap-3">
          {AA_CLASSES.map((cls) => (
            <div key={cls.key} className="flex flex-1 flex-col" style={{ flexGrow: cls.residues.length }}>
              <div className="flex h-[140px] items-end gap-[2px] border-b border-slate-300">
                {cls.residues.split("").map((aa) => {
                  const c = byAA[aa];
                  return (
                    <button
                      key={aa}
                      type="button"
                      onMouseEnter={() => setHover(aa)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(aa)}
                      onBlur={() => setHover(null)}
                      aria-label={`${aa} : ${c.percent.toFixed(1)} %`}
                      className="group flex h-full flex-1 items-end"
                    >
                      <span
                        className={`block w-full rounded-t-[4px] transition ${
                          hover === aa ? "bg-[#1c5cab]" : "bg-[#2a78d6] group-hover:bg-[#1c5cab]"
                        }`}
                        style={{ height: `${Math.max((c.percent / max) * 100, c.count ? 1.5 : 0)}%` }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 flex gap-[2px]">
                {cls.residues.split("").map((aa) => (
                  <span
                    key={aa}
                    className={`flex-1 text-center font-mono text-[13px] ${
                      hover === aa ? "font-bold text-slate-900" : "text-slate-600"
                    }`}
                  >
                    {aa}
                  </span>
                ))}
              </div>
              <p className="mt-1 border-t border-slate-200 pt-1 text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                {cls.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
