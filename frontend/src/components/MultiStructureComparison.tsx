"use client";

import dynamic from "next/dynamic";
import { Columns2, ExternalLink } from "lucide-react";

const Structure3DViewer = dynamic(() => import("@/components/Structure3DViewer"), { ssr: false });

type HighlightRange = { start: number; end: number; label?: string; color?: string };

type PDBStructure = {
  pdb_id: string;
  title?: string;
  method?: string;
  resolution?: number | null;
};

type AlphaFoldData = {
  available: boolean;
  pdb_url?: string;
  pdbUrl?: string;
  model_id?: string;
  alphafold_id?: string;
  confidence?: number | null;
  confidence_avg?: number | null;
};

export default function MultiStructureComparison({
  accession,
  selectedPdb,
  alphafold,
  activeRange,
  autoHighlightRanges = [],
}: {
  accession: string;
  selectedPdb: PDBStructure | null;
  alphafold: AlphaFoldData | null;
  activeRange?: HighlightRange | null;
  autoHighlightRanges?: HighlightRange[];
}) {
  const afUrl = alphafold?.pdb_url || alphafold?.pdbUrl;
  const viewerHighlightRanges = activeRange ? [activeRange] : [];
  const confidence = alphafold?.confidence ?? alphafold?.confidence_avg ?? null;

  if (!selectedPdb && !afUrl) return null;

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Columns2 size={17} className="text-[#0f4c81]" />
          <div>
            <h2 className="text-[16px] font-bold text-slate-900">Comparaison multi-structures</h2>
            <p className="text-[13px] text-slate-500">
              Visualisation côte à côte : structure expérimentale PDB et modèle AlphaFold.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {selectedPdb && (
            <a
              href={`https://www.rcsb.org/structure/${selectedPdb.pdb_id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-3 py-1 text-[13px] font-semibold text-blue-700"
            >
              PDB {selectedPdb.pdb_id}
              <ExternalLink size={12} />
            </a>
          )}

          {afUrl && (
            <a
              href={`https://alphafold.ebi.ac.uk/entry/${accession}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-3 py-1 text-[13px] font-semibold text-violet-700"
            >
              AlphaFold
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6 overflow-hidden rounded border border-blue-100 bg-blue-50">
          <div className="flex items-center justify-between border-b border-blue-100 bg-white px-3 py-2">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-blue-700">
                Experimental structure
              </p>
              <p className="text-[14px] font-bold text-slate-900">
                {selectedPdb ? `${selectedPdb.pdb_id} · ${selectedPdb.method || "PDB"}` : "PDB absent"}
              </p>
            </div>
            <span className="rounded bg-blue-100 px-2 py-1 text-[12px] font-bold text-blue-800">
              PDB
            </span>
          </div>

          <div className="h-[320px] bg-white">
            {selectedPdb ? (
              <Structure3DViewer
                pdbId={selectedPdb.pdb_id}
                mode="pdb"
                highlightRanges={viewerHighlightRanges}
                autoHighlightRanges={autoHighlightRanges}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Aucune structure expérimentale.
              </div>
            )}
          </div>
        </div>

        <div className="col-span-6 overflow-hidden rounded border border-violet-100 bg-violet-50">
          <div className="flex items-center justify-between border-b border-violet-100 bg-white px-3 py-2">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-violet-700">
                Predicted model
              </p>
              <p className="text-[14px] font-bold text-slate-900">
                {alphafold?.model_id || alphafold?.alphafold_id || "AlphaFold"}
              </p>
            </div>
            <span className="rounded bg-violet-100 px-2 py-1 text-[12px] font-bold text-violet-800">
              pLDDT {confidence !== null ? Math.round(confidence) : "-"}
            </span>
          </div>

          <div className="h-[320px] bg-white">
            {afUrl ? (
              <Structure3DViewer
                pdbUrl={afUrl}
                mode="alphafold"
                highlightRanges={viewerHighlightRanges}
                autoHighlightRanges={autoHighlightRanges}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Aucun modèle AlphaFold.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-[14px] leading-5 text-slate-700">
        Cette comparaison côte à côte évite les erreurs de superposition automatique tout en permettant d’inspecter les mêmes régions : segments TM, outliers Ramachandran, site actif et domaines.
      </div>
    </section>
  );
}
