"use client";

import { useEffect, useMemo, useState } from "react";
import { Atom, Eye, Loader2, MapPin, Target } from "lucide-react";

type HighlightRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
};

type LigandResidue = {
  chain: string;
  resi: number;
  resn: string;
  distance: number;
  label: string;
  pocket_score?: number;
};

type Ligand = {
  name: string;
  chain: string;
  resi: number;
  atom_count: number;
  nearby_residues: LigandResidue[];
  type?: string;
};

type ActiveSiteData = {
  pdb_id: string;
  cutoff: number;
  mode?: "ligand_based" | "predicted_pocket" | "none" | "error";
  confidence?: "high" | "medium" | "low";
  ligands: Ligand[];
  active_site_residues: number[];
  highlight_ranges: HighlightRange[];
  predicted_pocket?: LigandResidue[];
  interpretation: string;
  detected_het_groups?: Record<string, number>;
  error?: string;
};

type SelectedSite = {
  type: "ligand" | "residue" | "site" | "prediction";
  label: string;
  range: HighlightRange;
};

export default function ActiveSitePanel({
  pdbId,
  activeRange,
  onFocusRange,
}: {
  pdbId?: string | null;
  activeRange?: HighlightRange | null;
  onFocusRange?: (range: HighlightRange) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ActiveSiteData | null>(null);
  const [selectedSite, setSelectedSite] = useState<SelectedSite | null>(null);

  useEffect(() => {
    if (!pdbId) {
      setData(null);
      setSelectedSite(null);
      return;
    }

    const loadActiveSite = async () => {
      setLoading(true);

      try {
        const res = await fetch(
          `http://127.0.0.1:8000/api/active-site/${pdbId}?cutoff=5`
        );

        const json: ActiveSiteData = await res.json();
        setData(json);
        setSelectedSite(null);
      } catch (error) {
        console.error("Erreur active site:", error);
        setData(null);
        setSelectedSite(null);
      }

      setLoading(false);
    };

    loadActiveSite();
  }, [pdbId]);

  const residuesToShow = useMemo(() => {
    if (!data) return [];

    if (data.mode === "predicted_pocket") {
      return data.predicted_pocket || [];
    }

    const residues: LigandResidue[] = [];

    data.ligands.forEach((ligand) => {
      ligand.nearby_residues.forEach((residue) => residues.push(residue));
    });

    const unique = new Map<string, LigandResidue>();

    residues.forEach((residue) => {
      const key = `${residue.chain}-${residue.resi}-${residue.resn}`;
      if (!unique.has(key)) unique.set(key, residue);
    });

    return Array.from(unique.values()).sort((a, b) => a.resi - b.resi);
  }, [data]);

  const focusRange = (selection: SelectedSite) => {
    setSelectedSite(selection);
    onFocusRange?.(selection.range);
  };

  const focusLigand = (ligand: Ligand) => {
    const residues = ligand.nearby_residues.map((residue) => residue.resi);
    if (!residues.length) return;

    focusRange({
      type: "ligand",
      label: `${ligand.name} ${ligand.chain}${ligand.resi}`,
      range: {
        start: Math.min(...residues),
        end: Math.max(...residues),
        label: `${ligand.name} binding pocket`,
        color: "#e11d48",
      },
    });
  };

  const focusWholeSite = () => {
    if (!data || data.active_site_residues.length === 0) return;

    const residues = data.active_site_residues;
    const color = data.mode === "predicted_pocket" ? "#7c3aed" : "#e11d48";

    focusRange({
      type: data.mode === "predicted_pocket" ? "prediction" : "site",
      label:
        data.mode === "predicted_pocket"
          ? "Poche fonctionnelle prédite"
          : "Site actif complet",
      range: {
        start: Math.min(...residues),
        end: Math.max(...residues),
        label:
          data.mode === "predicted_pocket"
            ? "Predicted functional pocket"
            : "Active site pocket",
        color,
      },
    });
  };

  if (!pdbId) {
    return (
      <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <Header />
        <div className="rounded border border-amber-100 bg-amber-50 p-3 text-[12px] text-amber-900">
          Sélectionne une structure PDB pour détecter les ligands et le site actif.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <Header />

      {loading && (
        <div className="flex items-center gap-2 rounded border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-800">
          <Loader2 size={15} className="animate-spin" />
          Analyse expert : ligands, résidus modifiés et poche fonctionnelle...
        </div>
      )}

      {!loading && data && (
        <div className="space-y-3">
          <ModeBanner mode={data.mode} confidence={data.confidence} />

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4 rounded border border-rose-100 bg-rose-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Atom size={16} className="text-rose-700" />
                  <p className="text-[12px] font-bold text-rose-900">
                    Ligands / groupes HET
                  </p>
                </div>

                <span className="rounded bg-white px-2 py-1 text-[10px] font-bold text-rose-700">
                  {data.ligands.length}
                </span>
              </div>

              {data.ligands.length > 0 ? (
                <div className="max-h-[345px] overflow-auto rounded border border-rose-100 bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-rose-100 text-rose-900">
                      <tr>
                        <th className="p-2 text-left">Ligand</th>
                        <th className="p-2 text-left">Chaîne</th>
                        <th className="p-2 text-left">Résidu</th>
                        <th className="p-2 text-left">Proches</th>
                        <th className="p-2 text-left">3D</th>
                      </tr>
                    </thead>

                    <tbody>
                      {data.ligands.slice(0, 80).map((ligand, ligandIndex) => {
                        const isSelected =
                          selectedSite?.type === "ligand" &&
                          selectedSite.label ===
                            `${ligand.name} ${ligand.chain}${ligand.resi}`;

                        return (
                          <tr
                            key={`${ligand.name}-${ligand.chain}-${ligand.resi}-${ligand.atom_count}-${ligandIndex}`}
                            className={`border-t ${
                              isSelected ? "bg-rose-50" : "bg-white"
                            }`}
                          >
                            <td className="p-2">
                              <div className="font-bold text-rose-800">
                                {ligand.name}
                              </div>
                              <div className="text-[10px] font-semibold text-rose-600">
                                {ligand.type === "known_important"
                                  ? "important"
                                  : "HET"}
                              </div>
                            </td>

                            <td className="p-2">{ligand.chain}</td>

                            <td className="p-2">{ligand.resi}</td>

                            <td className="p-2">
                              {ligand.nearby_residues.length}
                            </td>

                            <td className="p-2">
                              <button
                                onClick={() => focusLigand(ligand)}
                                disabled={!ligand.nearby_residues.length}
                                className={`inline-flex items-center justify-center rounded px-2 py-1 text-[10px] font-bold text-white ${
                                  isSelected
                                    ? "bg-rose-900"
                                    : "bg-rose-600 hover:bg-rose-700"
                                } disabled:bg-slate-300`}
                              >
                                <Eye size={11} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] leading-5 text-rose-900">
                    Aucun ligand classique détecté.
                  </p>

                  {data.detected_het_groups &&
                    Object.keys(data.detected_het_groups).length > 0 && (
                      <div className="rounded bg-white p-2 text-[11px] text-slate-700">
                        <p className="font-bold text-slate-900">
                          Groupes HET observés
                        </p>
                        <p className="mt-1">
                          {Object.keys(data.detected_het_groups).join(", ")}
                        </p>
                      </div>
                    )}
                </div>
              )}
            </div>

            <div className="col-span-5 rounded border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin size={16} className="text-slate-700" />
                  <p className="text-[12px] font-bold text-slate-900">
                    Résidus interactifs
                  </p>
                </div>

                <button
                  onClick={focusWholeSite}
                  disabled={!data.active_site_residues.length}
                  className="inline-flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white disabled:bg-slate-300"
                >
                  <Target size={11} />
                  afficher tout
                </button>
              </div>

              {residuesToShow.length > 0 ? (
                <div className="max-h-[345px] overflow-auto rounded border border-slate-200 bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-slate-100">
                      <tr>
                        <th className="p-2 text-left">Résidu</th>
                        <th className="p-2 text-left">Chaîne</th>
                        <th className="p-2 text-left">
                          {data.mode === "predicted_pocket"
                            ? "Score poche"
                            : "Distance"}
                        </th>
                        <th className="p-2 text-left">3D</th>
                      </tr>
                    </thead>

                    <tbody>
                      {residuesToShow.map((residue, residueIndex) => {
                        const isActive =
                          activeRange?.start === residue.resi &&
                          activeRange?.end === residue.resi;

                        const color =
                          data.mode === "predicted_pocket" ? "#7c3aed" : "#e11d48";

                        return (
                          <tr
                            key={`${residue.chain}-${residue.resn}-${residue.resi}-${residue.distance}-${residueIndex}`}
                            className={`border-t ${
                              isActive ? "bg-rose-50" : "bg-white"
                            }`}
                          >
                            <td className="p-2 font-bold text-slate-800">
                              {residue.resn}
                              {residue.resi}
                            </td>

                            <td className="p-2">{residue.chain}</td>

                            <td className="p-2">
                              {data.mode === "predicted_pocket"
                                ? residue.pocket_score ?? "-"
                                : `${residue.distance} Å`}
                            </td>

                            <td className="p-2">
                              <button
                                onClick={() =>
                                  focusRange({
                                    type:
                                      data.mode === "predicted_pocket"
                                        ? "prediction"
                                        : "residue",
                                    label: `${residue.resn}${residue.resi}`,
                                    range: {
                                      start: residue.resi,
                                      end: residue.resi,
                                      label: `${residue.resn}${residue.resi}`,
                                      color,
                                    },
                                  })
                                }
                                className={`inline-flex items-center justify-center rounded px-2 py-1 text-[10px] font-bold text-white ${
                                  isActive
                                    ? "bg-slate-900"
                                    : data.mode === "predicted_pocket"
                                    ? "bg-violet-600 hover:bg-violet-700"
                                    : "bg-rose-600 hover:bg-rose-700"
                                }`}
                              >
                                <Eye size={11} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[12px] leading-5 text-slate-600">
                  Aucun résidu fonctionnel ou proche de ligand n’a été identifié.
                </p>
              )}
            </div>

            <div className="col-span-3 rounded border border-emerald-100 bg-emerald-50 p-3">
              <p className="mb-2 text-[12px] font-bold text-emerald-900">
                Interprétation expert
              </p>

              <p className="text-[12px] leading-5 text-emerald-900">
                {data.interpretation}
              </p>

              {selectedSite && (
                <div className="mt-3 rounded border border-emerald-200 bg-white p-2 text-[11px] leading-5 text-slate-700">
                  <p className="font-bold text-emerald-900">
                    Sélection active
                  </p>
                  <p>
                    {selectedSite.label} · résidus{" "}
                    {selectedSite.range.start}-{selectedSite.range.end}
                  </p>
                </div>
              )}

              <div className="mt-3 rounded bg-white p-2 text-[11px] leading-5 text-slate-700">
                Rouge = ligand/site de liaison réel. Violet = poche prédite
                sans ligand classique.
              </div>

              {data.error && (
                <div className="mt-3 rounded border border-red-100 bg-red-50 p-2 text-[11px] leading-5 text-red-800">
                  Erreur backend : {data.error}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ModeBanner({
  mode,
  confidence,
}: {
  mode?: string;
  confidence?: string;
}) {
  const label =
    mode === "ligand_based"
      ? "Détection ligand-based"
      : mode === "predicted_pocket"
      ? "Fallback expert : poche prédite"
      : "Aucune preuve forte";

  const cls =
    mode === "ligand_based"
      ? "border-emerald-100 bg-emerald-50 text-emerald-900"
      : mode === "predicted_pocket"
      ? "border-violet-100 bg-violet-50 text-violet-900"
      : "border-amber-100 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded border p-3 text-[12px] font-semibold ${cls}`}>
      {label} · confiance : {confidence || "low"}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Atom size={17} className="text-rose-700" />

      <div>
        <h2 className="text-[14px] font-bold text-slate-900">
          Site actif expert interactif
        </h2>

        <p className="text-[11px] text-slate-500">
          Détection ligand-based, ligands biologiques importants, puis fallback par poche fonctionnelle prédite.
        </p>
      </div>
    </div>
  );
}
