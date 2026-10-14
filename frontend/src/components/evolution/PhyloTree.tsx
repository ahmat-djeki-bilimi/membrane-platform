"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import type { PhyloTree as PhyloTreeData } from "@/lib/conservation";
import {
  TREE_RANKS,
  layoutTree,
  leafColoring,
  legendRows,
  organismName,
  scaleBarLength,
  type ColorMode,
  type TreeMode,
} from "@/lib/phylo";
import { downloadText } from "@/lib/sequence";

const ROW_PX = 20;
const LABEL_PX = 280;
const PAD_TOP = 12;
const PAD_LEFT = 12;
const SCALE_PX = 34;
const CAPTION_PX = 22;
const LEGEND_ROW_PX = 18;
const MIN_TREE_PX = 220;
const WEAK_SUPPORT = 0.5;

type SupportMode = "dots" | "values" | "none";

const RANK_ORDER = ["domain", "kingdom", "phylum", "class", "order", "family"];

/**
 * Arbre phylogénétique rectangulaire : espèces colorées par groupe
 * taxonomique ou par organisme, soutien bootstrap des branches, sélection
 * d'une espèce partagée avec l'alignement. La légende et la méthode sont
 * dessinées dans l'image pour que les exports SVG et PNG soient complets.
 */
export default function PhyloTree({
  tree,
  selectedId,
  onSelect,
  fileBase,
  maxHeight = 640,
}: {
  tree: PhyloTreeData;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  fileBase: string;
  /** Hauteur maximale de la zone de l'arbre avant défilement (px). */
  maxHeight?: number;
}) {
  const [mode, setMode] = useState<TreeMode>("phylogram");
  const [supportMode, setSupportMode] = useState<SupportMode>("dots");
  const [colorMode, setColorMode] = useState<ColorMode>("group");
  const [rank, setRank] = useState(tree.group_rank ?? "phylum");
  const [hovered, setHovered] = useState<number | null>(null);
  const [width, setWidth] = useState(900);
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutTree(tree.root, mode), [tree, mode]);
  const coloring = useMemo(() => leafColoring(tree.leaves, colorMode, rank), [tree, colorMode, rank]);
  const strong = tree.support?.strong ?? 0.7;
  const rankLabel = TREE_RANKS.find((r) => r.rank === rank)?.label ?? rank;

  const legendTitle = colorMode === "organism" ? "Organisme" : rankLabel;
  const rows = legendRows(coloring.legend, width - 24 - legendTitle.length * 7);
  const legendH = rows.length ? rows.length * LEGEND_ROW_PX + 8 : 0;
  const top = PAD_TOP + legendH;
  const treeWidth = Math.max(MIN_TREE_PX, width - LABEL_PX - PAD_LEFT - 8);
  const bottom = (mode === "phylogram" ? SCALE_PX : 8) + CAPTION_PX;
  const height = top + layout.order.length * ROW_PX + bottom;
  const sx = (x: number) => PAD_LEFT + (x / layout.depth) * treeWidth;
  const sy = (y: number) => top + y * ROW_PX + ROW_PX / 2;
  const labelX = PAD_LEFT + treeWidth + 10;
  const scale = scaleBarLength(layout.depth);
  const hoveredLeaf = hovered !== null ? tree.leaves[hovered] : null;
  const hoveredRow = hovered !== null ? layout.order.indexOf(hovered) : -1;

  const caption = [
    tree.reconstruction ? "Neighbor-Joining" : tree.method,
    tree.model ? `distances ${tree.model.label} (${tree.model.formula})` : null,
    "racine au point médian",
    tree.bootstrap_replicates ? `bootstrap ${tree.bootstrap_replicates} réplicats${supportMode === "dots" ? ` (● ≥ ${Math.round(strong * 100)} %, ○ ${WEAK_SUPPORT * 100}–${Math.round(strong * 100)} %)` : ""}` : "sans bootstrap",
  ]
    .filter(Boolean)
    .join(" · ");

  const serialize = () => {
    const clone = svgRef.current!.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.querySelectorAll("[data-interactive]").forEach((el) => el.remove());
    return new XMLSerializer().serializeToString(clone);
  };
  const exportSvg = () => svgRef.current && downloadText(`${fileBase}_arbre.svg`, serialize(), "image/svg+xml");
  const exportPng = async () => {
    if (!svgRef.current) return;
    setExporting(true);
    try {
      await downloadPng(serialize(), width, height, `${fileBase}_arbre.png`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Représentation de l'arbre"
            value={mode}
            onChange={setMode}
            options={[
              { value: "phylogram", label: "Longueurs de branches", title: "Branches proportionnelles au nombre de substitutions" },
              { value: "cladogram", label: "Topologie seule", title: "Espèces alignées, seul l'ordre des embranchements compte" },
            ]}
          />
          <SegmentedControl
            label="Couleur des espèces"
            value={colorMode}
            onChange={setColorMode}
            options={[
              { value: "group", label: "Groupe taxonomique" },
              { value: "organism", label: "Organisme" },
              { value: "none", label: "Sans couleur" },
            ]}
          />
          {colorMode === "group" && (
            <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
              Rang
              <select value={rank} onChange={(e) => setRank(e.target.value)} className="rounded-xl border border-slate-300 px-2 py-1 text-[13px] outline-none focus:border-blue-500">
                {TREE_RANKS.map((r) => (
                  <option key={r.rank} value={r.rank}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <SegmentedControl
            label="Valeurs de support des branches"
            value={supportMode}
            onChange={setSupportMode}
            options={[
              { value: "dots", label: "Bootstrap : repères", title: `Point plein : ≥ ${Math.round(strong * 100)} % ; point creux : ${WEAK_SUPPORT * 100} à ${Math.round(strong * 100)} %` },
              { value: "values", label: "Valeurs (%)", title: "Pourcentage de réplicats qui retrouvent chaque embranchement" },
              { value: "none", label: "Masquer" },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton label="Newick" title="Arbre au format Newick, avec longueurs de branches et valeurs de bootstrap" onClick={() => downloadText(`${fileBase}_arbre.nwk`, tree.newick + "\n")} />
          <ExportButton label="SVG" title="Image vectorielle (publication, retouche)" onClick={exportSvg} />
          <ExportButton label={exporting ? "PNG…" : "PNG"} title="Image (résolution ×2)" onClick={exportPng} />
        </div>
      </div>

      <div ref={containerRef} className="relative overflow-y-auto rounded-lg border border-slate-200" style={{ maxHeight }}>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Arbre phylogénétique de ${tree.leaf_count} séquences`}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          onMouseLeave={() => setHovered(null)}
        >
          <rect width={width} height={height} fill="#ffffff" />

          {/* Légende des couleurs (incluse dans les exports) */}
          {rows.map((row, r) => {
            let x = PAD_LEFT;
            return (
              <g key={`legend-${r}`} fontSize={12} fill="#334155">
                {r === 0 && (
                  <text x={x} y={PAD_TOP + 10} fontWeight={600} fill="#0f172a">
                    {legendTitle} :
                  </text>
                )}
                {row.map((item) => {
                  const start = r === 0 && x === PAD_LEFT ? PAD_LEFT + legendTitle.length * 7 + 14 : x;
                  x = start + 22 + (item.name.length + String(item.count).length + 3) * 7;
                  const y = PAD_TOP + r * LEGEND_ROW_PX;
                  return (
                    <g key={item.name}>
                      <rect x={start} y={y + 1} width={10} height={10} rx={2} fill={item.color} />
                      <text x={start + 15} y={y + 10}>
                        <tspan fontStyle={colorMode === "organism" || rank === "genus" ? "italic" : undefined}>{item.name}</tspan>
                        <tspan fill="#64748b"> ({item.count})</tspan>
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Ligne de l'espèce sélectionnée ou survolée */}
          {layout.order.map((leafIndex, row) => {
            const leaf = tree.leaves[leafIndex];
            const isSelected = leaf.id === selectedId;
            const isHovered = hovered === leafIndex;
            if (!isSelected && !isHovered && !leaf.is_query) return null;
            return (
              <rect
                key={`bg-${leafIndex}`}
                data-interactive={isHovered && !isSelected && !leaf.is_query ? "" : undefined}
                x={0}
                y={top + row * ROW_PX}
                width={width}
                height={ROW_PX}
                fill={isSelected ? "#ede9fe" : leaf.is_query ? "#eff6ff" : "#f8fafc"}
              />
            );
          })}

          {/* Branches */}
          <g stroke="#475569" strokeWidth={1.5} fill="none" strokeLinecap="round">
            {layout.nodes.map((n, i) => (
              <g key={i}>
                {n.x !== n.parentX && <line x1={sx(n.parentX)} x2={sx(n.x)} y1={sy(n.y)} y2={sy(n.y)} />}
                {n.childrenY && <line x1={sx(n.x)} x2={sx(n.x)} y1={sy(n.childrenY[0])} y2={sy(n.childrenY[1])} />}
              </g>
            ))}
          </g>

          {/* Repères jusqu'aux noms (phylogramme) */}
          {mode === "phylogram" && (
            <g stroke="#cbd5e1" strokeWidth={1} strokeDasharray="2 3">
              {layout.nodes
                .filter((n) => n.leaf !== undefined && sx(n.x) < labelX - 14)
                .map((n) => (
                  <line key={n.leaf} x1={sx(n.x) + 3} x2={labelX - 4} y1={sy(n.y)} y2={sy(n.y)} />
                ))}
            </g>
          )}

          {/* Soutien des embranchements */}
          {supportMode !== "none" &&
            layout.nodes
              .filter((n) => n.support !== undefined && n.support !== null)
              .map((n, i) => {
                const value = n.support!;
                if (supportMode === "values") {
                  return (
                    <text key={`s-${i}`} x={sx(n.x) - 3} y={sy(n.y) - 4} textAnchor="end" fontSize={10} fontWeight={value >= strong ? 600 : 400} fill={value >= strong ? "#0f172a" : "#94a3b8"}>
                      {Math.round(value * 100)}
                    </text>
                  );
                }
                if (value < WEAK_SUPPORT) return null;
                return (
                  <circle
                    key={`s-${i}`}
                    cx={sx(n.x)}
                    cy={sy(n.y)}
                    r={3.5}
                    fill={value >= strong ? "#0f172a" : "#ffffff"}
                    stroke={value >= strong ? "#ffffff" : "#0f172a"}
                    strokeWidth={1.5}
                  >
                    <title>Bootstrap {Math.round(value * 100)} %</title>
                  </circle>
                );
              })}

          {/* Espèces */}
          {layout.order.map((leafIndex, row) => {
            const leaf = tree.leaves[leafIndex];
            const y = sy(row);
            return (
              <g
                key={`leaf-${leafIndex}`}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(leafIndex)}
                onClick={() => onSelect?.(leaf.id === selectedId || leaf.is_query ? null : leaf.id)}
              >
                <rect x={0} y={top + row * ROW_PX} width={width} height={ROW_PX} fill="transparent" />
                {colorMode !== "none" && <rect x={labelX} y={y - 5} width={10} height={10} rx={2} fill={coloring.colorOf(leaf)} />}
                <text x={labelX + (colorMode !== "none" ? 16 : 0)} y={y + 4.5} fontSize={13} fill={leaf.is_query ? "#4338ca" : "#1e293b"}>
                  <tspan fontStyle="italic" fontWeight={leaf.is_query ? 700 : 400}>
                    {truncate(organismName(leaf.organism) ?? (leaf.is_query ? "Protéine étudiée" : leaf.id), 30)}
                  </tspan>
                  <tspan fontSize={11} fill="#64748b" dx={6}>
                    {leaf.is_query ? "protéine étudiée" : leaf.id}
                  </tspan>
                </text>
              </g>
            );
          })}

          {/* Échelle */}
          {mode === "phylogram" && scale > 0 && (
            <g transform={`translate(${PAD_LEFT}, ${height - CAPTION_PX - SCALE_PX / 2})`} fontSize={11} fill="#475569">
              <line x1={0} x2={(scale / layout.depth) * treeWidth} y1={0} y2={0} stroke="#334155" strokeWidth={2} />
              <text x={(scale / layout.depth) * treeWidth + 8} y={4}>
                {scale.toLocaleString("fr-FR")} substitution{scale >= 2 ? "s" : ""} par site
              </text>
            </g>
          )}

          {/* Méthode (incluse dans les exports) */}
          <text x={PAD_LEFT} y={height - 8} fontSize={11} fill="#64748b">
            {caption}
          </text>
        </svg>

        {hoveredLeaf && hoveredRow >= 0 && (
          <div
            className="pointer-events-none absolute z-10 max-w-[360px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] shadow-lg"
            style={{ top: top + (hoveredRow + 1) * ROW_PX + 4, right: 12 }}
          >
            <p className="font-semibold italic text-slate-900">{hoveredLeaf.organism ?? (hoveredLeaf.is_query ? "Protéine étudiée" : hoveredLeaf.id)}</p>
            <p className="font-mono text-slate-600">{hoveredLeaf.id}</p>
            {hoveredLeaf.identity !== null && !hoveredLeaf.is_query && (
              <p className="text-slate-700">Identité avec la protéine étudiée : {(hoveredLeaf.identity * 100).toFixed(0)} %</p>
            )}
            {Object.keys(hoveredLeaf.lineage ?? {}).length > 0 && (
              <p className="mt-1 text-slate-500">
                {RANK_ORDER.filter((r) => hoveredLeaf.lineage[r]).map((r) => hoveredLeaf.lineage[r]).join(" › ")}
              </p>
            )}
            {!hoveredLeaf.is_query && <p className="mt-1 text-[12px] text-violet-700">Cliquer pour la repérer dans l’alignement</p>}
          </div>
        )}
      </div>

      {tree.saturated_pairs > 0 && (
        <p className="mt-2 text-[13px] text-slate-500">
          {tree.saturated_pairs} paire(s) trop divergente(s) ou trop peu recouvrante(s) : distance plafonnée à {tree.max_distance}.
        </p>
      )}
    </div>
  );
}

/** Image PNG (résolution ×2) d'un SVG sérialisé. */
async function downloadPng(svg: string, width: number, height: number, filename: string) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d")!;
  context.scale(2, 2);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ExportButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
    >
      <Download size={13} />
      {label}
    </button>
  );
}
