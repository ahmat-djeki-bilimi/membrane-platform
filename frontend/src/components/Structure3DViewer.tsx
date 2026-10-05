"use client";

import { useEffect, useRef } from "react";
import type { GLViewer } from "3dmol";

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
  /** Chaîne de la structure ; sans chaîne, toutes les chaînes sont concernées. */
  chain?: string;
};

type Structure3DViewerProps = {
  pdbId?: string;
  pdbUrl?: string;
  pdbText?: string;
  background?: string;
  mode?: "pdb" | "alphafold";
  highlightRanges?: HighlightRange[];
  autoHighlightRanges?: HighlightRange[];
  /** Coloration du ruban seul (ex. conservation), sans bâtonnets. */
  colorRanges?: HighlightRange[];
};

export default function Structure3DViewer({
  pdbId,
  pdbUrl,
  pdbText,
  background = "white",
  mode = "pdb",
  highlightRanges = [],
  autoHighlightRanges = [],
  colorRanges = [],
}: Structure3DViewerProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  // Clés stables : le viewer n'est recréé que si le contenu des plages change
  const highlightKey = JSON.stringify(highlightRanges);
  const autoHighlightKey = JSON.stringify(autoHighlightRanges);
  const colorKey = JSON.stringify(colorRanges);

  useEffect(() => {
    const host = viewerRef.current;
    const highlights: HighlightRange[] = JSON.parse(highlightKey);
    const autoHighlights: HighlightRange[] = JSON.parse(autoHighlightKey);
    const colors: HighlightRange[] = JSON.parse(colorKey);
    let mounted = true;
    let viewer: GLViewer | null = null;

    const colorByPlddt = (atom: { b?: number; properties?: { b?: number } }) => {
      const b = Number(atom?.b || atom?.properties?.b || 0);
      if (b >= 90) return "#1f4e9d";
      if (b >= 70) return "#37a2d8";
      if (b >= 50) return "#f6d84a";
      return "#f08a24";
    };

    const buildResidueList = (start: number, end: number) => {
      const residues: number[] = [];
      for (let i = start; i <= end; i++) residues.push(i);
      return residues;
    };

    const selection = (range: HighlightRange) => ({
      resi: buildResidueList(range.start, range.end),
      ...(range.chain ? { chain: range.chain } : {}),
    });

    const applyRangeStyle = (v: GLViewer, range: HighlightRange, color: string, focused = false) => {
      v.setStyle(selection(range), { cartoon: { color, thickness: focused ? 1.1 : 0.75 } });
      v.addStyle(selection(range), { stick: { color, radius: focused ? 0.18 : 0.12 } });
      if (focused) v.addStyle(selection(range), { sphere: { color, radius: 0.28, opacity: 0.65 } });
    };

    const loadViewer = async () => {
      if (!host) return;
      host.innerHTML = "";

      const $3Dmol = await import("3dmol");
      if (!mounted) return;

      const v = $3Dmol.createViewer(host, { backgroundColor: background });
      viewer = v;

      let structureData = pdbText;

      if (!structureData && pdbUrl) {
        const response = await fetch(pdbUrl);
        structureData = await response.text();
      }

      if (!structureData && pdbId) {
        const response = await fetch(`https://files.rcsb.org/view/${pdbId.toUpperCase()}.pdb`);
        structureData = await response.text();
      }

      if (!structureData || !mounted) return;

      v.addModel(structureData, "pdb");

      if (mode === "alphafold") {
        v.setStyle({}, { cartoon: { colorfunc: colorByPlddt, thickness: 0.55 } });
      } else {
        v.setStyle({}, { cartoon: { color: "#94a3b8", thickness: 0.55 } });
      }

      colors.forEach((range) => {
        v.setStyle(selection(range), { cartoon: { color: range.color || "#94a3b8", thickness: 0.55 } });
      });
      autoHighlights.forEach((range) => applyRangeStyle(v, range, range.color || "#f59e0b", false));
      highlights.forEach((range) => applyRangeStyle(v, range, range.color || "#ef4444", true));

      if (highlights.length > 0) v.zoomTo(selection(highlights[0]));
      else v.zoomTo();

      v.render();
    };

    loadViewer().catch((err) => {
      console.error("Erreur viewer 3D :", err);
    });

    return () => {
      mounted = false;
      if (viewer) {
        try {
          viewer.clear();
          viewer.render();
        } catch {
          // Canevas déjà détruit : rien à libérer
        }
      }
      if (host) host.innerHTML = "";
    };
  }, [pdbId, pdbUrl, pdbText, background, mode, highlightKey, autoHighlightKey, colorKey]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <div
        ref={viewerRef}
        className="h-full w-full"
        style={{ width: "100%", height: "100%" }}
      />

      {highlightRanges.length > 0 && (
        <div className="absolute left-3 top-3 rounded-lg border border-red-100 bg-white/95 px-3 py-2 text-[13px] shadow-sm">
          <p className="font-bold text-red-700">Région ciblée</p>
          <p className="text-slate-700">
            {highlightRanges[0].label || "Région sélectionnée"} ·{" "}
            {highlightRanges[0].chain ? `chaîne ${highlightRanges[0].chain} · ` : ""}
            {highlightRanges[0].start}-{highlightRanges[0].end}
          </p>
        </div>
      )}
    </div>
  );
}
