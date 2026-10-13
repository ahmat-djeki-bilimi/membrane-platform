"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { disposeViewer, drawHydrophobicCore, ensureOutsideOnTop, orientSideView } from "@/components/Membrane3DViewer";
import type { GLViewer, LabelSpec } from "3dmol";

export type ResidueMark = { position: number; color: string; label?: string };
export type ResidueLink = { i: number; j: number; color: string; dashed?: boolean };

type Atom = { x: number; y: number; z: number; resi: number; atom: string };

/**
 * Structure placée dans la membrane (normale verticale, face externe en haut),
 * colorée résidu par résidu. Résidus marqués en bâtonnets, paires reliées par
 * des cylindres entre leurs Cβ.
 */
export default function ExplorerViewer({
  pdb,
  colors,
  defaultColor = "#e2e8f0",
  marks = [],
  links = [],
  focus = null,
  legend,
  height = 520,
}: {
  pdb: string;
  colors: Map<number, string>;
  defaultColor?: string;
  marks?: ResidueMark[];
  links?: ResidueLink[];
  focus?: number | null;
  legend?: React.ReactNode;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [showMembrane, setShowMembrane] = useState(true);
  const [spin, setSpin] = useState(false);
  const [hasMembrane, setHasMembrane] = useState(false);
  const oriented = useMemo(() => orientSideView(pdb), [pdb]);

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    setReady(false);
    import("3dmol").then(($3Dmol) => {
      if (cancelled || !hostRef.current) return;
      disposeViewer(viewerRef.current);
      hostRef.current.innerHTML = "";
      const viewer = $3Dmol.createViewer(hostRef.current, {
        backgroundColor: "white",
        orthographic: true,
      } as Parameters<typeof $3Dmol.createViewer>[1]);
      viewer.addModel(oriented, "pdb");
      viewerRef.current = viewer;
      setHasMembrane(viewer.selectedAtoms({ resn: "DUM" }).length > 0);
      // Cadrage sur la protéine : les plans de la membrane la débordent largement
      viewer.zoomTo({ hetflag: false });
      viewer.zoom(1.5);
      viewer.render();
      ensureOutsideOnTop(viewer);
      setReady(true);
    });
    return () => {
      cancelled = true;
      disposeViewer(viewerRef.current);
      viewerRef.current = null;
      setSpin(false);
    };
  }, [oriented]);

  // Style : recalculé sans recharger la structure
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    viewer.setStyle({}, {});
    viewer.removeAllShapes();
    viewer.removeAllLabels();
    viewer.setStyle(
      { hetflag: false },
      { cartoon: { colorfunc: (atom: { resi: number }) => colors.get(atom.resi) ?? defaultColor } }
    );

    for (const mark of marks) {
      viewer.addStyle({ resi: mark.position, hetflag: false }, { stick: { color: mark.color, radius: 0.25 } });
      if (mark.label) {
        viewer.addLabel(
          mark.label,
          {
            fontSize: 11,
            fontColor: "white",
            backgroundColor: mark.color,
            backgroundOpacity: 0.9,
            borderRadius: 3,
            inFront: true,
          } as LabelSpec,
          { resi: mark.position, atom: "CA" }
        );
      }
    }

    if (links.length) {
      const anchors = new Map<number, Atom>();
      for (const atom of viewer.selectedAtoms({ hetflag: false }) as unknown as Atom[]) {
        if (atom.atom === "CB" || (atom.atom === "CA" && !anchors.has(atom.resi))) anchors.set(atom.resi, atom);
      }
      for (const link of links) {
        const a = anchors.get(link.i);
        const b = anchors.get(link.j);
        if (!a || !b) continue;
        viewer.addCylinder({
          start: { x: a.x, y: a.y, z: a.z },
          end: { x: b.x, y: b.y, z: b.z },
          radius: 0.28,
          color: link.color,
          dashed: link.dashed,
          fromCap: 1,
          toCap: 1,
        } as Parameters<GLViewer["addCylinder"]>[0]);
      }
    }

    if (showMembrane) {
      viewer.setStyle({ resn: "DUM", atom: "O" }, { sphere: { radius: 0.45, color: "#e11d48" } });
      viewer.setStyle({ resn: "DUM", atom: "N" }, { sphere: { radius: 0.45, color: "#2563eb" } });
      drawHydrophobicCore(viewer);
    }
    if (focus) viewer.zoomTo({ resi: focus });
    viewer.render();
  }, [ready, colors, defaultColor, marks, links, showMembrane, focus]);

  useEffect(() => {
    if (viewerRef.current && ready) viewerRef.current.spin(spin ? "y" : false, 0.6);
  }, [spin, ready]);

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[13px]">
        {hasMembrane && (
          <label className="flex items-center gap-1 text-slate-700">
            <input type="checkbox" checked={showMembrane} onChange={(e) => setShowMembrane(e.target.checked)} />
            Limites de la membrane
          </label>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => setSpin((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold ${
              spin ? "bg-slate-800 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
            }`}
          >
            <RotateCw size={12} />
            Rotation
          </button>
          <button
            onClick={() => {
              viewerRef.current?.zoomTo({ hetflag: false });
              viewerRef.current?.render();
            }}
            className="rounded-md bg-white px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
          >
            Recentrer
          </button>
        </div>
      </div>
      <div className="relative" style={{ height }}>
        <div ref={hostRef} className="absolute inset-0" />
        {showMembrane && hasMembrane && ready && (
          <>
            <span className="pointer-events-none absolute left-3 top-3 z-10 rounded bg-white/90 px-2 py-1 text-[13px] font-semibold text-rose-700 shadow-sm ring-1 ring-rose-100">
              ▲ Côté externe
            </span>
            <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-white/90 px-2 py-1 text-[13px] font-semibold text-blue-700 shadow-sm ring-1 ring-blue-100">
              ▼ Côté cytoplasmique
            </span>
          </>
        )}
        {legend && ready && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 max-w-[220px] space-y-0.5 rounded bg-white/90 px-2 py-1 text-[12px] text-slate-700 shadow-sm ring-1 ring-slate-200">
            {legend}
          </div>
        )}
        {!ready && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white text-[14px] text-slate-500">
            Chargement de la structure…
          </div>
        )}
      </div>
    </div>
  );
}

export function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
