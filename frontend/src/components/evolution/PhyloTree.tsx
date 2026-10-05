"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import type { PhyloTree as PhyloTreeData } from "@/lib/conservation";
import { groupColors, layoutTree, scaleBarLength, UNKNOWN_GROUP_COLOR, type TreeMode } from "@/lib/phylo";
import { downloadText } from "@/lib/sequence";

const ROW_PX = 20;
const LABEL_PX = 280;
const PAD_TOP = 12;
const PAD_LEFT = 12;
const SCALE_PX = 34;
const MIN_TREE_PX = 220;
const STRONG_SUPPORT = 0.7;

const RANK_ORDER = ["domain", "kingdom", "phylum", "class", "order", "family"];
const shortName = (organism: string | null, fallback: string) => (organism ?? fallback).replace(/\s*\(.*\)$/, "");

/**
 * Arbre phylogénétique rectangulaire : espèces colorées par groupe
 * taxonomique, soutien bootstrap des branches, sélection d'une espèce
 * partagée avec l'alignement.
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
  const [showSupport, setShowSupport] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [width, setWidth] = useState(900);
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
  const colors = useMemo(() => groupColors(tree.groups), [tree]);

  const treeWidth = Math.max(MIN_TREE_PX, width - LABEL_PX - PAD_LEFT - 8);
  const height = PAD_TOP + layout.order.length * ROW_PX + (mode === "phylogram" ? SCALE_PX : 8);
  const sx = (x: number) => PAD_LEFT + (x / layout.depth) * treeWidth;
  const sy = (y: number) => PAD_TOP + y * ROW_PX + ROW_PX / 2;
  const labelX = PAD_LEFT + treeWidth + 10;
  const scale = scaleBarLength(layout.depth);
  const colorOf = (group: string | null) => (group && colors.get(group)) || UNKNOWN_GROUP_COLOR;
  const hoveredLeaf = hovered !== null ? tree.leaves[hovered] : null;
  const hoveredRow = hovered !== null ? layout.order.indexOf(hovered) : -1;

  const exportSvg = () => {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    downloadText(`${fileBase}_arbre.svg`, clone.outerHTML, "image/svg+xml");
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
          <label className="flex items-center gap-1.5 text-[14px] text-slate-700">
            <input type="checkbox" checked={showSupport} onChange={(e) => setShowSupport(e.target.checked)} className="accent-[#0f4c81]" />
            Valeurs de bootstrap
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton label="Newick" onClick={() => downloadText(`${fileBase}_arbre.nwk`, tree.newick + "\n")} />
          <ExportButton label="Image (SVG)" onClick={exportSvg} />
        </div>
      </div>

      {tree.groups.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-slate-700">
          <span className="font-semibold text-slate-900">{tree.group_rank_label} :</span>
          {tree.groups.map((g) => (
            <span key={g.name} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: colorOf(g.name) }} />
              <span className="italic">{g.name}</span>
              <span className="text-slate-500">({g.count})</span>
            </span>
          ))}
          {tree.leaves.some((l) => !l.group) && (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: UNKNOWN_GROUP_COLOR }} />
              Non classé
            </span>
          )}
        </div>
      )}

      <div ref={containerRef} className="relative overflow-y-auto rounded-md border border-slate-200" style={{ maxHeight }}>
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

          {/* Ligne de l'espèce sélectionnée ou survolée */}
          {layout.order.map((leafIndex, row) => {
            const leaf = tree.leaves[leafIndex];
            const isSelected = leaf.id === selectedId;
            const isHovered = hovered === leafIndex;
            if (!isSelected && !isHovered && !leaf.is_query) return null;
            return (
              <rect
                key={`bg-${leafIndex}`}
                x={0}
                y={PAD_TOP + row * ROW_PX}
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
          {layout.nodes
            .filter((n) => n.support !== undefined && n.support !== null)
            .map((n, i) =>
              showSupport ? (
                n.support! >= 0.5 && (
                  <text
                    key={`s-${i}`}
                    x={sx(n.x) - 3}
                    y={sy(n.y) - 4}
                    textAnchor="end"
                    fontSize={10}
                    fill={n.support! >= STRONG_SUPPORT ? "#0f172a" : "#64748b"}
                  >
                    {Math.round(n.support! * 100)}
                  </text>
                )
              ) : (
                n.support! >= STRONG_SUPPORT && (
                  <circle key={`s-${i}`} cx={sx(n.x)} cy={sy(n.y)} r={3} fill="#0f172a" stroke="#ffffff" strokeWidth={1.5}>
                    <title>Bootstrap {Math.round(n.support! * 100)} %</title>
                  </circle>
                )
              )
            )}

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
                <rect x={0} y={PAD_TOP + row * ROW_PX} width={width} height={ROW_PX} fill="transparent" />
                <rect x={labelX} y={y - 5} width={10} height={10} rx={2} fill={colorOf(leaf.group)} />
                <text x={labelX + 16} y={y + 4.5} fontSize={13} fill={leaf.is_query ? "#0f4c81" : "#1e293b"}>
                  <tspan fontStyle="italic" fontWeight={leaf.is_query ? 700 : 400}>
                    {truncate(shortName(leaf.organism, leaf.is_query ? "Protéine étudiée" : leaf.id), 30)}
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
            <g transform={`translate(${PAD_LEFT}, ${height - SCALE_PX / 2})`} fontSize={11} fill="#475569">
              <line x1={0} x2={(scale / layout.depth) * treeWidth} y1={0} y2={0} stroke="#334155" strokeWidth={2} />
              <text x={(scale / layout.depth) * treeWidth + 8} y={4}>
                {scale.toLocaleString("fr-FR")} substitution{scale >= 2 ? "s" : ""} par site
              </text>
            </g>
          )}
        </svg>

        {hoveredLeaf && hoveredRow >= 0 && (
          <div
            className="pointer-events-none absolute z-10 max-w-[360px] rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] shadow-lg"
            style={{ top: PAD_TOP + (hoveredRow + 1) * ROW_PX + 4, right: 12 }}
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

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-500">
        {!showSupport && (
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden>
              <circle cx="5" cy="5" r="3.5" fill="#0f172a" />
            </svg>
            Embranchement robuste (bootstrap ≥ {STRONG_SUPPORT * 100} % sur {tree.bootstrap_replicates} réplicats)
          </span>
        )}
        <span>
          {tree.method}.
          {tree.saturated_pairs > 0 &&
            ` ${tree.saturated_pairs} paire(s) trop divergente(s) ou trop peu recouvrante(s) : distance plafonnée.`}
        </span>
      </div>
    </div>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
    >
      <Download size={13} />
      {label}
    </button>
  );
}
