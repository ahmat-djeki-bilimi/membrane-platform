"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RotateCw } from "lucide-react";
import { disposeViewer, drawHydrophobicCore, ensureOutsideOnTop, orientSideView } from "@/components/Membrane3DViewer";
import { DEVIATION_BANDS, PLDDT_BANDS, deviationColor, plddtColor, type ComparisonResult } from "@/lib/prediction";
import { downloadText } from "@/lib/sequence";

type Range = { start: number; end: number; label?: string; color?: string };
type ColorMode = "pair" | "deviation" | "plddt";
type Layout = "overlay" | "side";
type Which = "both" | "model" | "experimental";

const MODEL_COLOR = "#0e7490";
const EXPERIMENTAL_COLOR = "#c026d3";
const NOT_COMPARED = "#cbd5e1";
const OTHER_CHAINS_COLOR = "#94a3b8";
const FUSED_COLOR = "#f0abfc"; // partie de la chaîne comparée hors UniProt (protéine fusionnée)
// Modèles chargés : 0 = modèle prédit, 1 = chaîne comparée, 2 = reste du cristal
const COMPARED = [0, 1];
// Cadrage sur les protéines visibles (ni membrane, ni lipides du cristal)
const framing = (wholeCrystal: boolean) => (wholeCrystal ? { hetflag: false } : { hetflag: false, model: COMPARED });
// Agrandissement après cadrage : chaque vue est plus étroite en côte à côte
const ZOOM: Record<Layout, number> = { overlay: 1.4, side: 1.9 };

type StyleOptions = {
  which: Which;
  colorMode: ColorMode;
  showModel: boolean;
  showExperimental: boolean;
  showLigands: boolean;
  showMembrane: boolean;
  wholeCrystal: boolean;
  experimentalChain: string;
  activeRange: Range | null;
  deviation: Map<number, number>;
};

/**
 * Structure prédite (modèle 0, avec la membrane) et structure expérimentale
 * superposée (modèle 1), toutes deux dans le repère de la membrane du modèle.
 * Superposées dans une même vue, ou côte à côte dans deux vues synchronisées.
 */
export default function SuperpositionViewer({
  modelPdb,
  modelName = "ESMFold",
  comparison,
  fileBase,
  activeRange,
}: {
  modelPdb: string;
  modelName?: string;
  comparison: ComparisonResult;
  fileBase: string;
  activeRange?: Range | null;
}) {
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const viewersRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [layout, setLayout] = useState<Layout>("overlay");
  const [colorMode, setColorMode] = useState<ColorMode>("pair");
  const [showModel, setShowModel] = useState(true);
  const [showExperimental, setShowExperimental] = useState(true);
  const [showLigands, setShowLigands] = useState(true);
  const [showMembrane, setShowMembrane] = useState(true);
  const hasOthers = !!comparison.pdb_others;
  // Par défaut, tout le cristal ; le bouton ne garde que la chaîne comparée
  const [wholeCrystal, setWholeCrystal] = useState(true);
  const showWhole = hasOthers && wholeCrystal;
  const [spin, setSpin] = useState(false);

  const deviation = useMemo(() => new Map(comparison.residues.map((r) => [r.number, r.distance])), [comparison]);
  const panes: Which[] = layout === "overlay" ? ["both"] : ["model", "experimental"];

  // Création des vues : les deux structures sont chargées dans chaque vue
  // (même cadrage et même membrane) ; le style choisit ce qui est montré
  useEffect(() => {
    const hosts = (layout === "overlay" ? [leftRef] : [leftRef, rightRef]).map((r) => r.current);
    if (hosts.some((h) => !h)) return;
    let cancelled = false;
    setReady(false);
    import("3dmol").then(($3Dmol) => {
      if (cancelled) return;
      viewersRef.current.forEach(disposeViewer);
      const model = orientSideView(modelPdb);
      const experimental = orientSideView(comparison.pdb);
      const others = comparison.pdb_others ? orientSideView(comparison.pdb_others) : null;
      viewersRef.current = hosts.map((host) => {
        host!.innerHTML = "";
        const viewer = $3Dmol.createViewer(host!, { backgroundColor: "white", orthographic: true } as any);
        viewer.addModel(model, "pdb");
        viewer.addModel(experimental, "pdb");
        if (others) viewer.addModel(others, "pdb");
        viewer.zoomTo(framing(!!others));
        viewer.zoom(ZOOM[layout]);
        viewer.render();
        ensureOutsideOnTop(viewer);
        return viewer;
      });
      // Rotation et zoom synchronisés entre les deux vues
      if (viewersRef.current.length === 2) {
        viewersRef.current[0].linkViewer(viewersRef.current[1]);
        viewersRef.current[1].linkViewer(viewersRef.current[0]);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
      viewersRef.current.forEach(disposeViewer);
      viewersRef.current = [];
      setSpin(false);
    };
  }, [modelPdb, comparison.pdb, comparison.pdb_others, layout]);

  useEffect(() => {
    if (!ready) return;
    viewersRef.current.forEach((viewer, i) => {
      applyStyle(viewer, {
        which: panes[i],
        colorMode,
        showModel,
        showExperimental,
        showLigands,
        showMembrane,
        wholeCrystal: showWhole,
        experimentalChain: comparison.chain,
        activeRange: activeRange ?? null,
        deviation,
      });
      if (activeRange) viewer.zoomTo({ resi: `${activeRange.start}-${activeRange.end}`, hetflag: false, model: COMPARED });
      viewer.render();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layout, colorMode, showModel, showExperimental, showLigands, showMembrane, showWhole, activeRange, deviation]);

  // Recadrage quand on passe du cristal entier à la seule chaîne comparée
  useEffect(() => {
    if (!ready || !hasOthers) return;
    viewersRef.current.forEach((v) => {
      v.zoomTo(framing(showWhole));
      v.zoom(ZOOM[layout]);
      v.render();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWhole]);

  useEffect(() => {
    if (ready) viewersRef.current.forEach((v) => v.spin(spin ? "y" : false, 0.6));
  }, [spin, ready]);

  const recenter = () =>
    viewersRef.current.forEach((v) => {
      v.zoomTo(framing(showWhole));
      v.zoom(ZOOM[layout]);
      v.render();
    });

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void, swatch?: string) => (
    <label className="flex items-center gap-1 text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {swatch && <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: swatch }} />}
      {label}
    </label>
  );

  const crystal = `${comparison.pdb_id} (chaîne ${comparison.chain})`;

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[13px]">
        <Segmented
          value={layout}
          onChange={setLayout}
          options={[
            ["overlay", "Superposées"],
            ["side", "Côte à côte"],
          ]}
        />
        <Segmented
          value={colorMode}
          onChange={setColorMode}
          options={[
            ["pair", "Deux structures"],
            ["deviation", "Écart"],
            ["plddt", "pLDDT"],
          ]}
        />
        {layout === "overlay" && toggle(`Modèle ${modelName}`, showModel, setShowModel, MODEL_COLOR)}
        {layout === "overlay" && toggle(crystal, showExperimental, setShowExperimental, EXPERIMENTAL_COLOR)}
        {hasOthers && (
          <Segmented
            value={wholeCrystal ? "whole" : "chain"}
            onChange={(v) => setWholeCrystal(v === "whole")}
            options={[
              ["whole", "Tout le cristal"],
              ["chain", `Chaîne ${comparison.chain} seule`],
            ]}
          />
        )}
        {toggle("Ligands", showLigands, setShowLigands)}
        {toggle("Membrane", showMembrane, setShowMembrane)}
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
            onClick={recenter}
            className="rounded-md bg-white px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
          >
            Recentrer
          </button>
          <button
            onClick={() => downloadText(`${fileBase}_${comparison.pdb_id}_superpose.pdb`, comparison.pdb)}
            title="Chaîne expérimentale superposée, dans le repère de la membrane du modèle"
            className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
          >
            <Download size={12} />
            PDB superposé
          </button>
        </div>
      </div>

      <div className={`relative grid h-[540px] ${layout === "side" ? "grid-cols-2 divide-x divide-slate-200" : ""}`}>
        {panes.map((which, i) => (
          <div key={`${layout}-${which}`} className="relative">
            <div ref={i === 0 ? leftRef : rightRef} className="absolute inset-0" />
            {layout === "side" && (
              <span
                className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded px-2 py-1 text-[13px] font-semibold text-white shadow-sm"
                style={{ backgroundColor: which === "model" ? MODEL_COLOR : EXPERIMENTAL_COLOR }}
              >
                {which === "model" ? `Modèle ${modelName}` : `Cristal ${crystal}`}
              </span>
            )}
          </div>
        ))}

        {ready && showMembrane && (
          <>
            <span className="pointer-events-none absolute left-3 top-3 z-10 rounded bg-white/90 px-2 py-1 text-[13px] font-semibold text-rose-700 shadow-sm ring-1 ring-rose-100">
              ▲ Côté externe
            </span>
            <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-white/90 px-2 py-1 text-[13px] font-semibold text-blue-700 shadow-sm ring-1 ring-blue-100">
              ▼ Côté cytoplasmique
            </span>
          </>
        )}
        {ready && (
          <Legend
            layout={layout}
            colorMode={colorMode}
            crystal={crystal}
            modelName={modelName}
            others={showWhole ? comparison.other_chains : []}
          />
        )}
        {!ready && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white text-[14px] text-slate-500">
            Chargement de la superposition…
          </div>
        )}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="inline-flex rounded-md bg-white p-0.5 ring-1 ring-slate-200">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`rounded px-2 py-0.5 font-semibold ${value === key ? "bg-slate-800 text-white" : "text-slate-600 hover:text-slate-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Legend({
  layout,
  colorMode,
  crystal,
  modelName,
  others,
}: {
  layout: Layout;
  colorMode: ColorMode;
  crystal: string;
  modelName: string;
  others: ComparisonResult["other_chains"];
}) {
  const fused = others.find((o) => o.fused);
  const otherChains = others.filter((o) => !o.fused).map((o) => o.chain);
  const rows: { color: string; label: string }[] =
    colorMode === "pair"
      ? [
          { color: MODEL_COLOR, label: `Modèle ${modelName}` },
          { color: EXPERIMENTAL_COLOR, label: `Cristal ${crystal}` },
        ]
      : [
          ...(colorMode === "deviation" ? DEVIATION_BANDS : PLDDT_BANDS).map((b) => ({ color: b.color, label: b.label })),
          ...(colorMode === "deviation" ? [{ color: NOT_COMPARED, label: "non observé dans le cristal" }] : []),
          ...(layout === "overlay" ? [{ color: EXPERIMENTAL_COLOR, label: `Cristal (tube fin)` }] : []),
        ];
  if (fused) rows.push({ color: FUSED_COLOR, label: `Chaîne ${fused.chain} hors UniProt (fusion)` });
  if (otherChains.length) rows.push({ color: OTHER_CHAINS_COLOR, label: `Autres chaînes : ${otherChains.join(", ")}` });
  const title = colorMode === "pair" ? null : colorMode === "deviation" ? "Modèle : écart au cristal" : "Modèle : pLDDT";
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 space-y-0.5 rounded bg-white/90 px-2 py-1 text-[12px] text-slate-700 shadow-sm ring-1 ring-slate-200">
      {title && <p className="font-semibold">{title}</p>}
      {rows.map((r) => (
        <span key={r.label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: r.color }} />
          {r.label}
        </span>
      ))}
    </div>
  );
}

function applyStyle(viewer: any, o: StyleOptions) {
  viewer.setStyle({}, {});
  viewer.removeAllShapes();
  const showModel = o.which === "model" || (o.which === "both" && o.showModel);
  const showExperimental = o.which === "experimental" || (o.which === "both" && o.showExperimental);

  const byDeviation = (atom: { resi: number }) => {
    const d = o.deviation.get(atom.resi);
    return d == null ? NOT_COMPARED : deviationColor(d);
  };
  const byPlddt = (atom: { b: number }) => plddtColor(atom.b);

  if (showModel) {
    const colorfunc = o.colorMode === "deviation" ? byDeviation : o.colorMode === "plddt" ? byPlddt : () => MODEL_COLOR;
    viewer.setStyle({ model: 0, hetflag: false }, { cartoon: { colorfunc } });
  }
  if (showExperimental) {
    const style =
      o.colorMode === "pair" || o.which === "experimental"
        ? // Seul dans sa vue, le cristal prend la même coloration que le modèle (écarts aux mêmes positions)
          { cartoon: o.which === "experimental" && o.colorMode === "deviation" ? { colorfunc: byDeviation } : { color: EXPERIMENTAL_COLOR } }
        : // Superposé à un modèle coloré : tube fin pour rester lisible
          { cartoon: { color: EXPERIMENTAL_COLOR, style: "trace", thickness: 0.35 } };
    viewer.setStyle({ model: 1, hetflag: false }, style);
    if (o.showLigands) viewer.setStyle({ model: 1, hetflag: true }, { stick: { radius: 0.18, colorscheme: "greenCarbon" } });
  }
  // Reste du cristal : autres chaînes en gris, partie fusionnée de la chaîne comparée en rose
  if (showExperimental && o.wholeCrystal) {
    viewer.setStyle({ model: 2, hetflag: false }, { cartoon: { color: OTHER_CHAINS_COLOR } });
    viewer.setStyle({ model: 2, hetflag: false, chain: o.experimentalChain }, { cartoon: { color: FUSED_COLOR } });
    if (o.showLigands) viewer.setStyle({ model: 2, hetflag: true }, { stick: { radius: 0.18, colorscheme: "greenCarbon" } });
  }
  if (o.showMembrane) {
    viewer.setStyle({ model: 0, resn: "DUM", atom: "O" }, { sphere: { radius: 0.5, color: "#e11d48" } });
    viewer.setStyle({ model: 0, resn: "DUM", atom: "N" }, { sphere: { radius: 0.5, color: "#2563eb" } });
    drawHydrophobicCore(viewer);
  }
  if (o.activeRange) {
    const resi = `${o.activeRange.start}-${o.activeRange.end}`;
    if (showModel) viewer.addStyle({ model: 0, resi, hetflag: false }, { stick: { color: MODEL_COLOR, radius: 0.22 } });
    if (showExperimental) viewer.addStyle({ model: 1, resi, hetflag: false }, { stick: { color: EXPERIMENTAL_COLOR, radius: 0.18 } });
  }
}
