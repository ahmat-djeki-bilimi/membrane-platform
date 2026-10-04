"use client";

import { Brain, CheckCircle2, Dna, FileText, ShieldCheck, Waves } from "lucide-react";

type PDBStructure = {
  pdb_id: string;
  title?: string;
  method?: string;
  resolution?: number | null;
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

type MembraneSegment = {
  start: number;
  end: number;
  label?: string;
};

type MembraneData = {
  is_membrane?: boolean;
  predicted_type?: string;
  tm_segments?: MembraneSegment[];
};

type QualityData = {
  ramachandran?: {
    favored_percent?: number | null;
    allowed_percent?: number | null;
    outliers_percent?: number | null;
    status?: string;
  };
  geometry?: {
    clashscore?: number | null;
    sidechain_outliers_percent?: number | null;
    rsrz_outliers_percent?: number | null;
  };
};

export default function AutoScientificInterpretation({
  accession,
  activeSource,
  selectedPdb,
  alphafold,
  membraneData,
  qualityData,
}: {
  accession: string;
  activeSource: "pdb" | "alphafold" | "ai";
  selectedPdb: PDBStructure | null;
  alphafold: AlphaFoldData | null;
  membraneData: MembraneData | null;
  qualityData: QualityData | null;
}) {
  const tmSegments = membraneData?.tm_segments || [];
  const tmCount = tmSegments.length;

  const confidence =
    alphafold?.confidence ?? alphafold?.confidence_avg ?? null;

  const ramaOutliers = qualityData?.ramachandran?.outliers_percent ?? null;
  const ramaFavored = qualityData?.ramachandran?.favored_percent ?? null;
  const clashscore = qualityData?.geometry?.clashscore ?? null;

  const globalLevel = computeGlobalLevel({
    tmCount,
    confidence,
    ramaOutliers,
    clashscore,
    hasPdb: !!selectedPdb,
  });

  const biologicalText = buildBiologicalInterpretation({
    tmCount,
    membraneType: membraneData?.predicted_type,
    selectedPdb,
    alphafold,
  });

  const structuralText = buildStructuralInterpretation({
    selectedPdb,
    confidence,
    ramaOutliers,
    ramaFavored,
    clashscore,
    activeSource,
  });

  const cautionText = buildCautionText({
    tmCount,
    ramaOutliers,
    clashscore,
    selectedPdb,
    activeSource,
  });

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-[#0f4c81]" />
          <div>
            <h2 className="text-[14px] font-bold text-slate-900">
              Interprétation 
            </h2>
            <p className="text-[11px] text-slate-500">
              Conclusion générée à partir de la structure, des segments TM et de la validation géométrique.
            </p>
          </div>
        </div>

        <span className={`rounded px-3 py-1 text-[11px] font-bold ${levelClass(globalLevel.level)}`}>
          {globalLevel.label}
        </span>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <InterpretBlock
          icon={<Waves size={15} />}
          title="Lecture membranaire"
          text={biologicalText}
          tone="blue"
        />

        <InterpretBlock
          icon={<ShieldCheck size={15} />}
          title="Fiabilité structurale"
          text={structuralText}
          tone="emerald"
        />

        <InterpretBlock
          icon={<Dna size={15} />}
          title="Points à surveiller"
          text={cautionText}
          tone="amber"
        />
      </div>

      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <FileText size={15} className="text-slate-700" />
          <p className="text-[12px] font-bold text-slate-900">
            Conclusion.
          </p>
        </div>

        <p className="text-[12px] leading-6 text-slate-700">
          {buildReportConclusion({
            accession,
            tmCount,
            membraneType: membraneData?.predicted_type,
            selectedPdb,
            confidence,
            ramaOutliers,
            ramaFavored,
            clashscore,
            globalLabel: globalLevel.label,
          })}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <MiniStat
          label="Segments TM"
          value={tmCount > 0 ? String(tmCount) : "-"}
        />
        <MiniStat
          label="pLDDT moyen"
          value={confidence !== null ? String(Math.round(confidence)) : "-"}
        />
        <MiniStat
          label="Rama outliers"
          value={ramaOutliers !== null ? `${ramaOutliers}%` : "-"}
        />
        <MiniStat
          label="Clashscore"
          value={clashscore !== null ? String(clashscore) : "-"}
        />
      </div>
    </section>
  );
}

function computeGlobalLevel({
  tmCount,
  confidence,
  ramaOutliers,
  clashscore,
  hasPdb,
}: {
  tmCount: number;
  confidence: number | null;
  ramaOutliers: number | null;
  clashscore: number | null;
  hasPdb: boolean;
}) {
  let score = 0;

  if (hasPdb) score += 25;
  if (tmCount > 0) score += 20;
  if (confidence !== null && confidence >= 80) score += 20;
  if (ramaOutliers !== null && ramaOutliers <= 2) score += 20;
  if (clashscore !== null && clashscore <= 10) score += 15;

  if (score >= 80) return { level: "excellent", label: "Analyse robuste" };
  if (score >= 60) return { level: "good", label: "Analyse fiable" };
  if (score >= 40) return { level: "medium", label: "Analyse à confirmer" };
  return { level: "low", label: "Données limitées" };
}

function buildBiologicalInterpretation({
  tmCount,
  membraneType,
  selectedPdb,
  alphafold,
}: {
  tmCount: number;
  membraneType?: string;
  selectedPdb: PDBStructure | null;
  alphafold: AlphaFoldData | null;
}) {
  if (tmCount >= 6) {
    return `La protéine présente ${tmCount} segments transmembranaires, ce qui suggère une architecture membranaire multipasse. Ce profil est compatible avec des protéines de type récepteurs, transporteurs ou canaux membranaires. Les segments bleus dans le viewer correspondent aux régions hydrophobes probablement insérées dans la bicouche lipidique.`;
  }

  if (tmCount >= 2) {
    return `La protéine possède ${tmCount} segments transmembranaires détectés, indiquant une organisation membranaire probable. Ces régions doivent être considérées comme importantes pour l’ancrage membranaire et les interactions avec les lipides.`;
  }

  if (tmCount === 1) {
    return `Un segment transmembranaire est détecté, ce qui correspond à une protéine membranaire single-pass ou à une protéine d’ancrage. La région TM peut jouer un rôle central dans la localisation cellulaire.`;
  }

  return `Aucun segment transmembranaire clair n’a été détecté par la prédiction actuelle. Si la protéine est connue comme membranaire, il faudra confirmer avec DeepTMHMM/TMHMM ou les annotations UniProt TRANSMEM.`;
}

function buildStructuralInterpretation({
  selectedPdb,
  confidence,
  ramaOutliers,
  ramaFavored,
  clashscore,
  activeSource,
}: {
  selectedPdb: PDBStructure | null;
  confidence: number | null;
  ramaOutliers: number | null;
  ramaFavored: number | null;
  clashscore: number | null;
  activeSource: string;
}) {
  const pdbText = selectedPdb
    ? `La structure expérimentale ${selectedPdb.pdb_id} fournit une référence fiable pour l’analyse.`
    : "Aucune structure expérimentale active n’est sélectionnée.";

  const afText =
    confidence !== null
      ? ` Le modèle AlphaFold présente un pLDDT moyen d’environ ${Math.round(
          confidence
        )}, ce qui donne une estimation de la confiance locale.`
      : "";

  const ramaText =
    ramaOutliers !== null
      ? ` Le diagramme de Ramachandran indique ${ramaOutliers}% de résidus outliers${
          ramaFavored !== null ? ` et ${ramaFavored}% en régions favorables` : ""
        }.`
      : " Les données Ramachandran ne sont pas disponibles.";

  const clashText =
    clashscore !== null
      ? ` Le clashscore est de ${clashscore}, ce qui permet d’évaluer les contacts atomiques défavorables.`
      : "";

  return `${pdbText}${afText}${ramaText}${clashText}`;
}

function buildCautionText({
  tmCount,
  ramaOutliers,
  clashscore,
  selectedPdb,
  activeSource,
}: {
  tmCount: number;
  ramaOutliers: number | null;
  clashscore: number | null;
  selectedPdb: PDBStructure | null;
  activeSource: string;
}) {
  const cautions: string[] = [];

  if (tmCount === 0) {
    cautions.push("la prédiction TM doit être confirmée par un outil spécialisé si la protéine est supposée membranaire");
  }

  if (ramaOutliers !== null && ramaOutliers > 2) {
    cautions.push("les résidus Ramachandran outliers doivent être inspectés localement dans le viewer 3D");
  }

  if (clashscore !== null && clashscore > 10) {
    cautions.push("un clashscore élevé peut indiquer des contacts atomiques défavorables");
  }

  if (!selectedPdb) {
    cautions.push("l’absence de structure expérimentale limite la validation comparative");
  }

  if (cautions.length === 0) {
    return "Aucun point critique majeur n’est détecté automatiquement. Les régions colorées en rouge ou orange doivent toutefois être vérifiées dans leur contexte structural.";
  }

  return `Points à vérifier : ${cautions.join("; ")}.`;
}

function buildReportConclusion({
  accession,
  tmCount,
  membraneType,
  selectedPdb,
  confidence,
  ramaOutliers,
  ramaFavored,
  clashscore,
  globalLabel,
}: {
  accession: string;
  tmCount: number;
  membraneType?: string;
  selectedPdb: PDBStructure | null;
  confidence: number | null;
  ramaOutliers: number | null;
  ramaFavored: number | null;
  clashscore: number | null;
  globalLabel: string;
}) {
  const parts: string[] = [];

  parts.push(
    `L’analyse structurale de la protéine ${accession} met en évidence ${
      tmCount > 0
        ? `${tmCount} segment(s) transmembranaire(s), compatible(s) avec une organisation membranaire.`
        : "aucun segment transmembranaire clairement détecté par la méthode actuelle."
    }`
  );

  if (selectedPdb) {
    parts.push(
      `La structure expérimentale ${selectedPdb.pdb_id} a été utilisée comme référence principale pour l’évaluation structurale.`
    );
  }

  if (confidence !== null) {
    parts.push(
      `Le modèle AlphaFold présente un score moyen pLDDT d’environ ${Math.round(
        confidence
      )}, ce qui renseigne sur la confiance globale de la prédiction.`
    );
  }

  if (ramaOutliers !== null) {
    parts.push(
      `La validation Ramachandran montre ${ramaOutliers}% d’outliers${
        ramaFavored !== null ? ` et ${ramaFavored}% de résidus en régions favorables` : ""
      }, ce qui permet d’identifier les régions nécessitant une inspection locale.`
    );
  }

  if (clashscore !== null) {
    parts.push(
      `Le clashscore mesuré est de ${clashscore}, indiquant le niveau de contacts atomiques défavorables dans la structure.`
    );
  }

  parts.push(
    `Globalement, le niveau d’interprétation automatique est classé : ${globalLabel}.`
  );

  return parts.join(" ");
}

function InterpretBlock({
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
    <div className={`col-span-4 rounded border p-3 ${styles[tone]}`}>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <p className="text-[12px] font-bold">{title}</p>
      </div>
      <p className="text-[12px] leading-5">{text}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="text-[16px] font-bold text-slate-900">{value}</p>
    </div>
  );
}

function levelClass(level: string) {
  if (level === "excellent") return "bg-emerald-100 text-emerald-800";
  if (level === "good") return "bg-blue-100 text-blue-800";
  if (level === "medium") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}
