"use client";

import { useEffect, useRef, useState } from "react";
import { disposeViewer } from "@/components/Membrane3DViewer";
import { proteinColor, type ComparisonResult } from "@/lib/comparison";
import type { GLViewer } from "3dmol";

type ColorMode = "protein" | "plddt";

const plddtColor = (b: number) => (b > 90 ? "#0053d6" : b >= 70 ? "#65cbf3" : b >= 50 ? "#ffdb13" : "#ff7d45");

/**
 * Modèles AlphaFold superposés sur celui de la référence (un modèle 3Dmol par
 * protéine). Les résidus de la colonne sélectionnée sont montrés en bâtonnets
 * dans chaque protéine.
 */
export default function SuperposedViewer({
  result,
  selectedResidues,
}: {
  result: ComparisonResult;
  /** Résidu de chaque protéine à la colonne sélectionnée (null : absent). */
  selectedResidues: (number | null)[] | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState<boolean[]>(() => result.proteins.map(() => true));
  const [colorMode, setColorMode] = useState<ColorMode>("protein");
  const superposed = result.structures.superposed;

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    import("3dmol").then(($3Dmol) => {
      if (cancelled || !hostRef.current) return;
      disposeViewer(viewerRef.current);
      hostRef.current.innerHTML = "";
      const viewer = $3Dmol.createViewer(hostRef.current, { backgroundColor: "white" } as Parameters<typeof $3Dmol.createViewer>[1]);
      // Un modèle par protéine, dans l'ordre des protéines
      for (let p = 0; p < result.proteins.length; p++) {
        const entry = superposed.find((s) => s.protein === p);
        viewer.addModel(entry ? entry.pdb : "", "pdb");
      }
      viewer.zoomTo();
      viewer.render();
      viewerRef.current = viewer;
      setReady(true);
    });
    return () => {
      cancelled = true;
      disposeViewer(viewerRef.current);
      viewerRef.current = null;
      setReady(false);
    };
  }, [result, superposed]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    viewer.setStyle({}, {});
    result.proteins.forEach((_, p) => {
      if (!visible[p]) return;
      viewer.setStyle(
        { model: p },
        colorMode === "protein"
          ? { cartoon: { color: proteinColor(p), opacity: p === result.reference ? 1 : 0.85 } }
          : { cartoon: { colorfunc: (atom: { b: number }) => plddtColor(atom.b) } }
      );
      const residue = selectedResidues?.[p];
      if (residue) viewer.addStyle({ model: p, resi: residue }, { stick: { color: proteinColor(p), radius: 0.3 } });
    });
    viewer.render();
  }, [ready, visible, colorMode, selectedResidues, result]);

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2 text-[13px]">
        {result.proteins.map((protein, p) => {
          const present = superposed.some((s) => s.protein === p);
          return (
            <label key={protein.accession} className={`flex items-center gap-1.5 ${present ? "" : "text-slate-400"}`} title={present ? undefined : "Pas de modèle AlphaFold utilisable"}>
              <input type="checkbox" checked={present && visible[p]} disabled={!present} onChange={(e) => setVisible((v) => v.map((x, k) => (k === p ? e.target.checked : x)))} />
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: proteinColor(p) }} />
              <span className="font-mono">{protein.accession}</span>
              {p === result.reference && <span className="text-slate-500">(référence)</span>}
            </label>
          );
        })}
        <label className="ml-auto flex items-center gap-1.5">
          Couleur
          <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)} className="rounded border border-slate-300 px-1.5 py-0.5">
            <option value="protein">par protéine</option>
            <option value="plddt">par confiance (pLDDT)</option>
          </select>
        </label>
      </div>
      <div ref={hostRef} className="relative h-[520px] w-full" />
    </div>
  );
}
