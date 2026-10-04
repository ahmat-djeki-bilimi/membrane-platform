"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    $3Dmol?: any;
  }
}

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type TMSegment = {
  start: number;
  end: number;
  label?: string;
  source?: string;
  confidence?: string;
  hydrophobic_score?: number;
};

type Atom3D = {
  x: number;
  y: number;
  z: number;
  resi?: number;
};

type Geometry = {
  center: { x: number; y: number; z: number };
  upperZ: number;
  lowerZ: number;
  thickness: number;
  firstResidue: number;
  lastResidue: number;
  firstTM: number;
  lastTM: number;
};

const TM_COLORS = ["#ef4444", "#f97316", "#dc2626", "#fb923c", "#b91c1c"];

export default function Membrane3DViewer({
  pdbId,
  pdbUrl,
  segments,
  activeRange,
}: {
  pdbId?: string | null;
  pdbUrl?: string | null;
  segments: TMSegment[];
  activeRange?: HighlightRange | null;
}) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const viewerObject = useRef<any>(null);
  const [mode, setMode] = useState<"full" | "tm">("full");

  useEffect(() => {
    if (!viewerRef.current) return;

    const load3Dmol = () => {
      return new Promise<void>((resolve, reject) => {
        if (window.$3Dmol) {
          resolve();
          return;
        }

        const script = document.createElement("script");
        script.src = "https://3Dmol.org/build/3Dmol-min.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Impossible de charger 3Dmol.js"));
        document.body.appendChild(script);
      });
    };

    const render = async () => {
      await load3Dmol();

      if (!viewerRef.current || !window.$3Dmol) return;

      viewerRef.current.innerHTML = "";

      const viewer = window.$3Dmol.createViewer(viewerRef.current, {
        backgroundColor: "white",
      });

      viewerObject.current = viewer;

      const url =
        pdbUrl ||
        (pdbId ? `https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb` : "");

      if (!url) {
        viewerRef.current.innerHTML =
          "<div style='padding:20px;color:#64748b;font-size:13px'>Aucune structure PDB disponible.</div>";
        return;
      }

      const response = await fetch(url);
      const pdbText = await response.text();

      const model = viewer.addModel(pdbText, "pdb");
      const allAtoms: Atom3D[] = model.selectedAtoms({});
      const geometry = computeGeometry(model, segments, allAtoms);

      applyStyle(viewer, geometry, segments, activeRange, mode);

      viewer.render();

      setTimeout(() => {
        viewer.resize();
        viewer.render();
      }, 300);
    };

    render().catch((error) => {
      console.error("Erreur viewer membrane 3D:", error);
      if (viewerRef.current) {
        viewerRef.current.innerHTML =
          "<div style='padding:20px;color:#dc2626;font-size:13px'>Erreur de chargement du viewer 3D membrane.</div>";
      }
    });
  }, [
    pdbId,
    pdbUrl,
    JSON.stringify(segments),
    activeRange?.start,
    activeRange?.end,
    activeRange?.color,
    mode,
  ]);

  const resetView = () => {
    const viewer = viewerObject.current;
    if (!viewer) return;
    viewer.zoomTo();
    viewer.zoom(1.35);
    viewer.render();
  };

  const zoomTM = () => {
    const viewer = viewerObject.current;
    if (!viewer || segments.length === 0) return;
    const first = Math.min(...segments.map((s) => s.start));
    const last = Math.max(...segments.map((s) => s.end));
    viewer.zoomTo({ resi: `${first}-${last}` });
    viewer.zoom(1.9);
    viewer.render();
  };

  return (
    <div className="relative h-[620px] w-full overflow-hidden rounded border border-slate-200 bg-white">
      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white/95 px-3 py-2 shadow-sm">
        <span className="text-[11px] font-bold text-slate-800">
          Orientation 3D professionnelle
        </span>

        <button
          onClick={resetView}
          className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-200"
        >
          Reset
        </button>

        <button
          onClick={zoomTM}
          className="rounded bg-orange-100 px-2 py-1 text-[10px] font-bold text-orange-800 hover:bg-orange-200"
        >
          Zoom TM
        </button>

        <button
          onClick={() => setMode("full")}
          className={`rounded px-2 py-1 text-[10px] font-bold ${
            mode === "full"
              ? "bg-[#0f4c81] text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          Full
        </button>

        <button
          onClick={() => setMode("tm")}
          className={`rounded px-2 py-1 text-[10px] font-bold ${
            mode === "tm"
              ? "bg-[#0f4c81] text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          TM only
        </button>
      </div>

      <div className="absolute right-3 top-3 z-20 rounded border border-orange-200 bg-orange-50 px-3 py-1 text-[10px] font-bold text-orange-800 shadow-sm">
        Rouge/orange = segments TM
      </div>

      <div
        ref={viewerRef}
        className="absolute inset-0 h-full w-full overflow-hidden"
        style={{
          width: "100%",
          height: "100%",
          contain: "layout paint size",
        }}
      />
    </div>
  );
}

function applyStyle(
  viewer: any,
  geometry: Geometry,
  segments: TMSegment[],
  activeRange: HighlightRange | null | undefined,
  mode: "full" | "tm"
) {
  viewer.setStyle({}, {});

  if (mode === "full") {
    viewer.setStyle(
      {},
      {
        cartoon: {
          color: "#94a3b8",
          opacity: 0.56,
        },
      }
    );
  } else {
    viewer.setStyle(
      {},
      {
        cartoon: {
          color: "#cbd5e1",
          opacity: 0.18,
        },
      }
    );
  }

  segments.forEach((segment, index) => {
    const color = TM_COLORS[index % TM_COLORS.length];

    viewer.setStyle(
      { resi: `${segment.start}-${segment.end}` },
      {
        cartoon: {
          color,
          opacity: 1,
        },
        stick: {
          color,
          radius: mode === "tm" ? 0.18 : 0.10,
          opacity: mode === "tm" ? 0.85 : 0.45,
        },
      }
    );
  });

  viewer.setStyle(
    { resi: `${geometry.firstResidue}-${geometry.firstResidue + 4}` },
    {
      cartoon: { color: "#059669" },
      sphere: { color: "#059669", radius: 0.8 },
    }
  );

  viewer.setStyle(
    { resi: `${Math.max(geometry.lastResidue - 4, 1)}-${geometry.lastResidue}` },
    {
      cartoon: { color: "#e11d48" },
      sphere: { color: "#e11d48", radius: 0.8 },
    }
  );

  if (activeRange) {
    viewer.setStyle(
      { resi: `${activeRange.start}-${activeRange.end}` },
      {
        cartoon: {
          color: activeRange.color || "#7c3aed",
          opacity: 1,
        },
        stick: {
          color: activeRange.color || "#7c3aed",
          radius: 0.25,
        },
      }
    );
  }

  const size = 78;
  const center = geometry.center;

  viewer.addBox({
    center: { x: center.x, y: center.y, z: geometry.upperZ },
    dimensions: { w: size, h: size, d: 1.8 },
    color: "#3b82f6",
    opacity: 0.32,
  });

  viewer.addBox({
    center: { x: center.x, y: center.y, z: geometry.lowerZ },
    dimensions: { w: size, h: size, d: 1.8 },
    color: "#3b82f6",
    opacity: 0.32,
  });

  viewer.addBox({
    center: { x: center.x, y: center.y, z: center.z },
    dimensions: { w: size, h: size, d: Math.max(22, geometry.thickness) },
    color: "#fb923c",
    opacity: 0.16,
  });

  viewer.addLabel("Extracellulaire", {
    position: { x: center.x - 34, y: center.y - 30, z: geometry.upperZ + 5 },
    fontColor: "#0f4c81",
    backgroundColor: "white",
    fontSize: 12,
    borderThickness: 1,
    borderColor: "#bfdbfe",
  });

  viewer.addLabel("Intracellulaire / Cytoplasmique", {
    position: { x: center.x - 34, y: center.y - 30, z: geometry.lowerZ - 5 },
    fontColor: "#0f4c81",
    backgroundColor: "white",
    fontSize: 12,
    borderThickness: 1,
    borderColor: "#bfdbfe",
  });

  viewer.addLabel("N-ter", {
    sel: { resi: geometry.firstResidue },
    fontColor: "white",
    backgroundColor: "#059669",
    fontSize: 11,
  });

  viewer.addLabel("C-ter", {
    sel: { resi: geometry.lastResidue },
    fontColor: "white",
    backgroundColor: "#e11d48",
    fontSize: 11,
  });

  segments.forEach((segment, index) => {
    const mid = Math.round((segment.start + segment.end) / 2);

    viewer.addLabel(segment.label || `TM${index + 1}`, {
      sel: { resi: mid },
      fontColor: "white",
      backgroundColor: TM_COLORS[index % TM_COLORS.length],
      fontSize: 11,
    });
  });

  if (activeRange) {
    viewer.zoomTo({ resi: `${activeRange.start}-${activeRange.end}` });
    viewer.zoom(1.7);
  } else {
    viewer.zoomTo({ resi: `${geometry.firstTM}-${geometry.lastTM}` });
    viewer.zoom(1.35);
  }

  viewer.rotate(55, "x");
  viewer.rotate(-18, "y");
}

function computeGeometry(model: any, segments: TMSegment[], allAtoms: Atom3D[]): Geometry {
  const residues = allAtoms
    .map((atom) => atom.resi)
    .filter((resi): resi is number => typeof resi === "number");

  const firstResidue = residues.length ? Math.min(...residues) : 1;
  const lastResidue = residues.length ? Math.max(...residues) : 1;

  const firstTM = segments.length ? Math.min(...segments.map((s) => s.start)) : firstResidue;
  const lastTM = segments.length ? Math.max(...segments.map((s) => s.end)) : lastResidue;

  let tmAtoms: Atom3D[] = [];

  segments.forEach((segment) => {
    const atoms = model.selectedAtoms({
      resi: `${segment.start}-${segment.end}`,
    }) as Atom3D[];

    tmAtoms = [...tmAtoms, ...atoms];
  });

  if (!tmAtoms.length) {
    tmAtoms = allAtoms;
  }

  const center = averagePosition(tmAtoms);
  const zValues = tmAtoms.map((atom) => atom.z).filter((z) => typeof z === "number");
  const zMin = zValues.length ? Math.min(...zValues) : center.z - 12;
  const zMax = zValues.length ? Math.max(...zValues) : center.z + 12;

  const observedThickness = Math.abs(zMax - zMin);
  const thickness = Math.max(24, Math.min(36, observedThickness || 30));

  return {
    center,
    upperZ: center.z + thickness / 2,
    lowerZ: center.z - thickness / 2,
    thickness,
    firstResidue,
    lastResidue,
    firstTM,
    lastTM,
  };
}

function averagePosition(atoms: Atom3D[]) {
  if (!atoms.length) {
    return { x: 0, y: 0, z: 0 };
  }

  const total = atoms.reduce(
    (acc, atom) => {
      acc.x += atom.x || 0;
      acc.y += atom.y || 0;
      acc.z += atom.z || 0;
      return acc;
    },
    { x: 0, y: 0, z: 0 }
  );

  return {
    x: total.x / atoms.length,
    y: total.y / atoms.length,
    z: total.z / atoms.length,
  };
}
