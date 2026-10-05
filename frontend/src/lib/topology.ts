// Annotations UniProt communes aux schémas de topologie et d'architecture.

export type RegionType =
  | "domain"
  | "repeat"
  | "topological"
  | "transmembrane"
  | "intramembrane"
  | "signal"
  | "region"
  | "motif";

export type Region = {
  start: number;
  end: number;
  type: RegionType;
  label?: string;
  feature_type?: string;
};

export type Side = "in" | "out";

const INSIDE = ["cytoplasmic", "mitochondrial matrix", "stromal", "intravirion", "nuclear"];
const OUTSIDE = [
  "extracellular",
  "lumenal",
  "periplasmic",
  "mitochondrial intermembrane",
  "vacuolar",
  "exoplasmic",
  "virion surface",
  "thylakoid lumen",
  "intragranular",
];

export function sideOf(description?: string): Side | null {
  const text = (description || "").toLowerCase();
  if (INSIDE.some((t) => text.includes(t))) return "in";
  if (OUTSIDE.some((t) => text.includes(t))) return "out";
  return null;
}

const SIDE_NAMES: Record<string, string> = {
  extracellular: "Extracellulaire",
  periplasmic: "Périplasme",
  lumenal: "Lumière",
  "thylakoid lumen": "Lumière du thylakoïde",
  "mitochondrial intermembrane": "Espace intermembranaire",
  vacuolar: "Vacuole",
  cytoplasmic: "Cytoplasme",
  "mitochondrial matrix": "Matrice mitochondriale",
  stromal: "Stroma",
};

/** Nom français du compartiment d'après la description UniProt. */
export function compartmentName(description: string | undefined, side: Side) {
  const text = (description || "").toLowerCase();
  const key = Object.keys(SIDE_NAMES).find((k) => text.includes(k));
  if (key) return SIDE_NAMES[key];
  return side === "out" ? "Extérieur" : "Cytoplasme";
}

export type MembraneElement = {
  kind: "tm" | "reentrant";
  start: number;
  end: number;
  parts: Region[];
};

export type Topology = {
  elements: MembraneElement[];
  /** Côté de chaque boucle : loops[0] = extrémité N, loops[n] = extrémité C. */
  loops: { start: number; end: number; side: Side }[];
  sidesAnnotated: boolean;
  outsideName: string;
  insideName: string;
};

/**
 * Déduit la topologie : éléments membranaires ordonnés et côté de chaque
 * boucle, d'après les domaines topologiques ; les côtés non annotés sont
 * propagés à travers les hélices (une hélice TM change de côté, une région
 * intramembranaire ressort du même côté).
 */
export function buildTopology(regions: Region[], length: number): Topology | null {
  const membrane = regions
    .filter((r) => r.type === "transmembrane" || r.type === "intramembrane")
    .sort((a, b) => a.start - b.start);
  if (!membrane.length) return null;

  // Régions intramembranaires contiguës : une seule boucle réentrante
  const elements: MembraneElement[] = [];
  for (const r of membrane) {
    const last = elements[elements.length - 1];
    if (r.type === "intramembrane" && last?.kind === "reentrant" && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
      last.parts.push(r);
    } else {
      elements.push({
        kind: r.type === "transmembrane" ? "tm" : "reentrant",
        start: r.start,
        end: r.end,
        parts: [r],
      });
    }
  }

  const topo = regions.filter((r) => r.type === "topological");
  const sideAt = (pos: number) => {
    const d = topo.find((t) => t.start <= pos && t.end >= pos);
    return d ? sideOf(d.label) : null;
  };

  const bounds: { start: number; end: number }[] = [];
  let prev = 0;
  for (const e of elements) {
    bounds.push({ start: prev + 1, end: e.start - 1 });
    prev = e.end;
  }
  bounds.push({ start: prev + 1, end: Math.max(prev + 1, length) });

  const sides: (Side | null)[] = bounds.map((b) =>
    b.end >= b.start ? sideAt(Math.round((b.start + b.end) / 2)) : null
  );
  const sidesAnnotated = sides.some((s) => s !== null);
  if (!sidesAnnotated) sides[0] = "in";

  const flip = (s: Side): Side => (s === "in" ? "out" : "in");
  for (let i = 1; i < sides.length; i++) {
    if (sides[i] === null && sides[i - 1]) {
      sides[i] = elements[i - 1].kind === "tm" ? flip(sides[i - 1]!) : sides[i - 1];
    }
  }
  for (let i = sides.length - 2; i >= 0; i--) {
    if (sides[i] === null && sides[i + 1]) {
      sides[i] = elements[i].kind === "tm" ? flip(sides[i + 1]!) : sides[i + 1];
    }
  }

  const outDesc = topo.find((t) => sideOf(t.label) === "out")?.label;
  const inDesc = topo.find((t) => sideOf(t.label) === "in")?.label;

  return {
    elements,
    loops: bounds.map((b, i) => ({ ...b, side: sides[i] ?? "in" })),
    sidesAnnotated,
    outsideName: compartmentName(outDesc, "out"),
    insideName: compartmentName(inDesc, "in"),
  };
}

/** Pas de graduation « rond » donnant environ 8 à 12 graduations. */
export function niceStep(length: number) {
  const candidates = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return candidates.find((c) => length / c <= 12) ?? 10000;
}
