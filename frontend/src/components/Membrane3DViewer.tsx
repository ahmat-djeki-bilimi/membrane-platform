"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RotateCw } from "lucide-react";

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

export type OPMSubunit = {
  chain: string;
  name?: string | null;
  tilt?: number | null;
  segments: { start: number; end: number }[];
};

type ColorMode = "chain" | "tm" | "spectrum";

const OPM_COORDINATES = "https://opm-assets.storage.googleapis.com/pdb";
const TM_COLOR = "#d97706";
const CHAIN_COLORS = [
  "#2563eb", "#059669", "#7c3aed", "#db2777", "#0891b2",
  "#65a30d", "#c2410c", "#4f46e5", "#be123c", "#0d9488",
];

/**
 * Coordonnées orientées par OPM : la normale à la membrane est l’axe z et le
 * centre de la bicouche est en z = 0. Les atomes DUM matérialisent les limites
 * du cœur hydrophobe (nom O = face externe, N = face interne), affichés comme
 * sur le site OPM (rouge / bleu).
 *
 * Les coordonnées sont tournées pour que la membrane apparaisse horizontale,
 * face externe en haut.
 */
export default function Membrane3DViewer({
  opmPdbId,
  subunits,
  outsideLabel = "Côté externe",
  insideLabel = "Côté interne",
  activeRange,
}: {
  opmPdbId?: string | null;
  subunits: OPMSubunit[];
  outsideLabel?: string;
  insideLabel?: string;
  activeRange?: HighlightRange | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [pdbText, setPdbText] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [colorMode, setColorMode] = useState<ColorMode>("tm");
  const [showMembrane, setShowMembrane] = useState(true);
  const [showLigands, setShowLigands] = useState(true);
  const [spin, setSpin] = useState(false);

  // Téléchargement et réorientation des coordonnées (une fois par structure)
  useEffect(() => {
    setPdbText(null);
    if (!opmPdbId) return;
    let cancelled = false;
    setStatus("loading");
    fetch(`${OPM_COORDINATES}/${opmPdbId.toLowerCase()}.pdb`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => !cancelled && setPdbText(orientSideView(text)))
      .catch((e) => {
        console.error("Coordonnées OPM indisponibles :", e);
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [opmPdbId]);

  // Création du viewer
  useEffect(() => {
    if (!pdbText || !hostRef.current) return;
    let cancelled = false;

    import("3dmol").then(($3Dmol) => {
      if (cancelled || !hostRef.current) return;
      // L'ancien viewer doit cesser de tourner avant que son canevas soit retiré
      disposeViewer(viewerRef.current);
      viewerRef.current = null;
      hostRef.current.innerHTML = "";
      // Projection orthographique : les faces de la membrane restent des lignes nettes
      const viewer = $3Dmol.createViewer(hostRef.current, {
        backgroundColor: "white",
        orthographic: true,
      } as any);
      viewer.addModel(pdbText, "pdb");
      viewerRef.current = viewer;
      applyStyle(viewer, { subunits, colorMode, showMembrane, showLigands, activeRange: activeRange ?? null });
      viewer.zoomTo({ resn: "DUM", invert: true });
      viewer.render();
      ensureOutsideOnTop(viewer);
      setStatus("ready");
    });

    return () => {
      cancelled = true;
      disposeViewer(viewerRef.current);
      viewerRef.current = null;
      setSpin(false);
    };
    // Le style est appliqué séparément pour ne pas recréer le viewer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdbText]);

  // Mise à jour du style sans recharger la structure
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;
    applyStyle(viewer, { subunits, colorMode, showMembrane, showLigands, activeRange: activeRange ?? null });
    if (activeRange) viewer.zoomTo({ resi: `${activeRange.start}-${activeRange.end}` });
    viewer.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, showMembrane, showLigands, activeRange?.start, activeRange?.end, JSON.stringify(subunits), status]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;
    // Rotation autour de la normale à la membrane (axe vertical)
    viewer.spin(spin ? "y" : false, 0.6);
  }, [spin, status]);

  // Arrêt de la rotation quand le composant disparaît (changement d'onglet)
  useEffect(() => () => disposeViewer(viewerRef.current), []);

  if (!opmPdbId) {
    return (
      <div className="flex h-[460px] items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-[14px] text-slate-500">
        Cette structure n’est pas référencée dans OPM : son orientation dans la membrane
        n’est pas disponible.
      </div>
    );
  }

  const chains = subunits.map((s) => s.chain);

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[13px]">
        <span className="font-semibold text-slate-800">Coloration</span>
        <div className="inline-flex rounded-md bg-white p-0.5 ring-1 ring-slate-200">
          {(
            [
              ["chain", "Chaînes"],
              ["tm", "Segments TM"],
              ["spectrum", "N → C"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setColorMode(key)}
              className={`rounded px-2 py-0.5 font-semibold ${
                colorMode === key ? "bg-slate-800 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-slate-700">
          <input type="checkbox" checked={showMembrane} onChange={(e) => setShowMembrane(e.target.checked)} />
          Limites de la membrane
        </label>
        <label className="flex items-center gap-1 text-slate-700">
          <input type="checkbox" checked={showLigands} onChange={(e) => setShowLigands(e.target.checked)} />
          Ligands
        </label>
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
              viewerRef.current?.zoomTo({ resn: "DUM", invert: true });
              viewerRef.current?.render();
            }}
            className="rounded-md bg-white px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
          >
            Recentrer
          </button>
          <a
            href={`${OPM_COORDINATES}/${opmPdbId.toLowerCase()}.pdb`}
            className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
          >
            <Download size={12} />
            PDB orienté
          </a>
        </div>
      </div>

      <div className="relative h-[520px]">
        <div ref={hostRef} className="absolute inset-0" />

        {showMembrane && status === "ready" && (
          <>
            <span className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded bg-white/90 px-2 py-1 text-[13px] font-semibold text-rose-700 shadow-sm ring-1 ring-rose-100">
              <span className="h-2 w-2 rounded-full bg-rose-500" />▲ {outsideLabel}
            </span>
            <span className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded bg-white/90 px-2 py-1 text-[13px] font-semibold text-blue-700 shadow-sm ring-1 ring-blue-100">
              <span className="h-2 w-2 rounded-full bg-blue-500" />▼ {insideLabel}
            </span>
          </>
        )}

        {colorMode === "chain" && status === "ready" && chains.length > 0 && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 max-w-[180px] rounded bg-white/90 px-2 py-1 text-[12px] text-slate-700 shadow-sm ring-1 ring-slate-200">
            {chains.map((c, i) => (
              <span key={c} className="mr-2 inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: CHAIN_COLORS[i % CHAIN_COLORS.length] }} />
                {c}
              </span>
            ))}
          </div>
        )}
        {colorMode === "tm" && status === "ready" && (
          <span className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded bg-white/90 px-2 py-1 text-[12px] text-slate-700 shadow-sm ring-1 ring-slate-200">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: TM_COLOR }} />
            Segments TM (OPM)
          </span>
        )}

        {status === "loading" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white text-[14px] text-slate-500">
            Chargement des coordonnées orientées…
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white text-[14px] text-rose-600">
            Coordonnées OPM indisponibles pour {opmPdbId.toUpperCase()}.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Rotation des coordonnées pour une vue de côté : la normale (z) devient
 * l’axe vertical de l’écran (y), face externe en haut.
 */
function orientSideView(text: string): string {
  const lines = text.split("\n");

  let outside = 0;
  let inside = 0;
  for (const line of lines) {
    if (!line.startsWith("HETATM") || line.slice(17, 20) !== "DUM") continue;
    const z = parseFloat(line.slice(46, 54));
    const name = line.slice(12, 16).trim();
    if (name === "O") outside += z;
    if (name === "N") inside += z;
  }
  const sign = outside >= inside ? 1 : -1;

  const fmt = (v: number) => v.toFixed(3).padStart(8).slice(-8);

  return lines
    // Certains fichiers OPM placent les atomes DUM après la ligne END, où
    // 3Dmol arrête la lecture : on retire END / ENDMDL / MODEL.
    .filter((line) => !/^(END|ENDMDL|MODEL)\b/.test(line))
    .map((line) => {
      if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) return line;
      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if ([x, y, z].some(Number.isNaN)) return line;
      // Rotation de ±90° autour de x : (x, y, z) → (x, ∓z, ±y). L’axe y du
      // viewer pointe vers le bas de l’écran : la face externe (z > 0 dans
      // OPM) se retrouve en haut.
      const ny = -sign * z;
      const nz = sign * y;
      return line.slice(0, 30) + fmt(x) + fmt(ny) + fmt(nz) + line.slice(54);
    })
    .join("\n");
}

function applyStyle(
  viewer: any,
  {
    subunits,
    colorMode,
    showMembrane,
    showLigands,
    activeRange,
  }: {
    subunits: OPMSubunit[];
    colorMode: ColorMode;
    showMembrane: boolean;
    showLigands: boolean;
    activeRange: HighlightRange | null;
  }
) {
  viewer.setStyle({}, {});
  viewer.removeAllShapes();
  viewer.removeAllLabels();

  if (colorMode === "spectrum") {
    viewer.setStyle({ hetflag: false }, { cartoon: { color: "spectrum" } });
  } else if (colorMode === "tm") {
    viewer.setStyle({ hetflag: false }, { cartoon: { color: "#cbd5e1" } });
    for (const subunit of subunits) {
      for (const seg of subunit.segments) {
        viewer.setStyle(
          { chain: subunit.chain, resi: `${seg.start}-${seg.end}` },
          { cartoon: { color: TM_COLOR } }
        );
      }
    }
    // Numérotation des segments sur la première chaîne
    const first = subunits[0];
    first?.segments.forEach((seg, i) => {
      const mid = Math.round((seg.start + seg.end) / 2);
      viewer.addLabel(
        `TM${i + 1}`,
        {
          fontSize: 12,
          fontColor: "white",
          backgroundColor: "#b45309",
          backgroundOpacity: 0.95,
          borderRadius: 4,
          inFront: true,
        },
        { chain: first.chain, resi: mid, atom: "CA" }
      );
    });
  } else {
    viewer.setStyle({ hetflag: false }, { cartoon: { color: "#94a3b8" } });
    subunits.forEach((subunit, i) => {
      viewer.setStyle(
        { chain: subunit.chain, hetflag: false },
        { cartoon: { color: CHAIN_COLORS[i % CHAIN_COLORS.length] } }
      );
    });
  }

  if (showLigands) {
    viewer.setStyle(
      { hetflag: true, not: { resn: ["DUM", "HOH", "WAT"] } },
      { stick: { radius: 0.18, colorscheme: "greenCarbon" } }
    );
  }

  if (showMembrane) {
    // Limites du cœur hydrophobe : O (face externe) en rouge, N (face interne) en bleu
    viewer.setStyle({ resn: "DUM", atom: "O" }, { sphere: { radius: 0.5, color: "#e11d48" } });
    viewer.setStyle({ resn: "DUM", atom: "N" }, { sphere: { radius: 0.5, color: "#2563eb" } });
    drawHydrophobicCore(viewer);
  }

  if (activeRange) {
    const color = activeRange.color || "#7c3aed";
    viewer.addStyle(
      { resi: `${activeRange.start}-${activeRange.end}`, hetflag: false },
      { stick: { color, radius: 0.22 } }
    );
  }
}

/** Cœur hydrophobe : bande translucide entre les deux faces (axe y après rotation). */
function drawHydrophobicCore(viewer: any) {
  const dummies: { x: number; y: number; z: number }[] = viewer.selectedAtoms({ resn: "DUM" });
  if (!dummies.length) return;
  const xs = dummies.map((a) => a.x);
  const ys = dummies.map((a) => a.y);
  const zs = dummies.map((a) => a.z);
  const span = (v: number[]) => Math.max(...v) - Math.min(...v);
  const mid = (v: number[]) => (Math.max(...v) + Math.min(...v)) / 2;
  viewer.addBox({
    center: { x: mid(xs), y: mid(ys), z: mid(zs) },
    dimensions: { w: span(xs), h: span(ys), d: span(zs) },
    color: "#fde68a",
    opacity: 0.18,
  });
}

/** Vérifie à l’écran que la face externe (DUM « O ») est au-dessus de la face interne. */
function ensureOutsideOnTop(viewer: any) {
  const outer = viewer.selectedAtoms({ resn: "DUM", atom: "O" })[0];
  const inner = viewer.selectedAtoms({ resn: "DUM", atom: "N" })[0];
  if (!outer || !inner || typeof viewer.modelToScreen !== "function") return;
  const o = viewer.modelToScreen({ x: outer.x, y: outer.y, z: outer.z });
  const n = viewer.modelToScreen({ x: inner.x, y: inner.y, z: inner.z });
  // Coordonnées écran : y croît vers le bas
  if (o && n && o.y > n.y) {
    viewer.rotate(180, "z");
    viewer.render();
  }
}

function disposeViewer(viewer: any) {
  if (!viewer) return;
  try {
    viewer.spin(false);
    viewer.clear();
  } catch {
    // Canevas déjà détruit : rien à libérer
  }
}
