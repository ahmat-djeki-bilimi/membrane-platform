"use client";

import { Activity, AlertTriangle, Brain, Eye, ShieldCheck } from "lucide-react";

type PDBStructure = {
  pdb_id: string;
  method?: string;
  resolution?: number | null;
  title?: string;
};

type AlphaFoldData = {
  available: boolean;
  confidence?: number;
  confidence_avg?: number;
  protein_name?: string;
  organism?: string;
  sequence?: string;
  sequence_length?: number;
};

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

export default function StructuralInterpretation({
  activeSource,
  selectedPdb,
  alphafold,
  activeRange,
  onFocusRange,
  onClearFocus,
}: {
  activeSource: "pdb" | "alphafold" | "ai";
  selectedPdb: PDBStructure | null;
  alphafold: AlphaFoldData | null;
  activeRange: HighlightRange | null;
  onFocusRange: (range: HighlightRange) => void;
  onClearFocus: () => void;
}) {
  const confidence =
    alphafold?.confidence ?? alphafold?.confidence_avg ?? null;

  const sequenceLength =
    alphafold?.sequence_length || alphafold?.sequence?.length || null;

  const pdbQuality =
    selectedPdb?.resolution && selectedPdb.resolution <= 2.5
      ? "high"
      : selectedPdb?.resolution && selectedPdb.resolution <= 4
      ? "medium"
      : "unknown";

  const afQuality =
    confidence !== null && confidence >= 90
      ? "very_high"
      : confidence !== null && confidence >= 70
      ? "high"
      : confidence !== null && confidence >= 50
      ? "low"
      : "very_low";

  const suggestedRanges = buildSuggestedRanges(sequenceLength || 0, afQuality);

  return (
    <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-[#0f4c81]" />
          <div>
            <h2 className="text-[14px] font-bold text-slate-900">
              Interprétation automatique reliée au viewer
            </h2>
            <p className="text-[11px] text-slate-500">
              Analyse biologique + ciblage direct des régions dans la structure 3D.
            </p>
          </div>
        </div>

        {activeRange && (
          <button
            onClick={onClearFocus}
            className="rounded border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white"
          >
            Réinitialiser le viewer
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <InterpretCard
          icon={<ShieldCheck size={16} />}
          title="Fiabilité structurale"
          text={
            activeSource === "pdb"
              ? pdbQuality === "high"
                ? `La structure PDB ${selectedPdb?.pdb_id} présente une bonne résolution (${selectedPdb?.resolution} Å), donc elle peut servir de référence expérimentale fiable.`
                : `La structure PDB ${selectedPdb?.pdb_id || "-"} est expérimentale, mais sa qualité doit être contrôlée avec la résolution et la validation wwPDB.`
              : activeSource === "alphafold"
              ? afQuality === "very_high"
                ? `Le modèle AlphaFold a une très forte confiance moyenne (pLDDT ≈ ${Math.round(confidence || 0)}). Le repliement principal est probablement fiable.`
                : afQuality === "high"
                ? `Le modèle AlphaFold a une confiance correcte (pLDDT ≈ ${Math.round(confidence || 0)}). Les domaines principaux sont exploitables.`
                : `Le modèle AlphaFold montre une confiance limitée. Les régions flexibles ou désordonnées doivent être vérifiées.`
              : "Le modèle IA interne n’est pas encore connecté. Sa fiabilité dépendra de ses scores de sortie."
          }
          tone="blue"
        />

        <InterpretCard
          icon={<Activity size={16} />}
          title="Comportement biologique"
          text={
            activeSource === "pdb"
              ? "La structure expérimentale permet d’étudier les domaines, les ligands, les interactions, les chaînes et les sites fonctionnels."
              : activeSource === "alphafold"
              ? "AlphaFold permet d’identifier les régions structurées, les régions flexibles et les domaines mobiles. Il faut combiner pLDDT et PAE."
              : "L’IA interne pourra proposer une hypothèse structurale simplifiée, surtout utile pour les régions transmembranaires."
          }
          tone="emerald"
        />

        <InterpretCard
          icon={<AlertTriangle size={16} />}
          title="Points à vérifier"
          text={
            activeSource === "pdb"
              ? "Vérifier les chaînes, les mutations, les ligands, la résolution et la correspondance avec l’accession UniProt."
              : activeSource === "alphafold"
              ? "Contrôler les régions à faible pLDDT, les ruptures de domaines, le PAE et comparer avec PDB si disponible."
              : "Comparer le modèle IA interne avec AlphaFold et PDB pour valider sa cohérence."
          }
          tone="amber"
        />
      </div>

      {activeSource === "alphafold" && suggestedRanges.length > 0 && (
        <div className="mt-4 rounded border border-violet-100 bg-violet-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Eye size={15} className="text-violet-700" />
            <p className="text-[12px] font-bold text-violet-900">
              Régions proposées pour inspection 3D
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {suggestedRanges.map((range) => (
              <button
                key={`${range.start}-${range.end}`}
                onClick={() => onFocusRange(range)}
                className={`rounded border px-3 py-2 text-left text-[11px] transition ${
                  activeRange?.start === range.start &&
                  activeRange?.end === range.end
                    ? "border-red-300 bg-red-50 text-red-800"
                    : "border-violet-100 bg-white text-slate-700 hover:border-violet-300"
                }`}
              >
                <p className="font-bold">{range.label}</p>
                <p>
                  Résidus {range.start}–{range.end}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-[12px] leading-5 text-slate-700">
        <b>Conclusion automatique :</b>{" "}
        {activeSource === "pdb"
          ? `La structure expérimentale ${selectedPdb?.pdb_id || ""} doit être considérée comme référence principale pour l’analyse structurale.`
          : activeSource === "alphafold"
          ? `AlphaFold fournit un modèle prédictif exploitable${sequenceLength ? ` pour une protéine de ${sequenceLength} acides aminés` : ""}. Les régions proposées peuvent être inspectées directement dans le viewer.`
          : "La prédiction IA interne servira de modèle complémentaire et devra être comparée aux références PDB et AlphaFold."}
      </div>
    </section>
  );
}

function buildSuggestedRanges(length: number, afQuality: string): HighlightRange[] {
  if (!length || length < 40) return [];

  const nTermEnd = Math.min(35, length);
  const middleStart = Math.max(1, Math.floor(length * 0.45));
  const middleEnd = Math.min(length, middleStart + Math.min(45, Math.floor(length * 0.12)));
  const cTermStart = Math.max(1, length - 35);

  const uncertainColor = afQuality === "very_high" ? "#f59e0b" : "#ef4444";

  return [
    {
      start: 1,
      end: nTermEnd,
      label: "Extrémité N-terminale",
      color: uncertainColor,
    },
    {
      start: middleStart,
      end: middleEnd,
      label: "Région centrale / domaine",
      color: "#7c3aed",
    },
    {
      start: cTermStart,
      end: length,
      label: "Extrémité C-terminale",
      color: uncertainColor,
    },
  ];
}

function InterpretCard({
  icon,
  title,
  text,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  tone: "blue" | "emerald" | "amber";
}) {
  const styles = {
    blue: "border-blue-100 bg-blue-50 text-blue-900",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-900",
    amber: "border-amber-100 bg-amber-50 text-amber-900",
  };

  return (
    <div className={`rounded border p-3 ${styles[tone]}`}>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <p className="text-[12px] font-bold">{title}</p>
      </div>
      <p className="text-[12px] leading-5">{text}</p>
    </div>
  );
}
