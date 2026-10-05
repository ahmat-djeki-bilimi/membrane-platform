// Analyses de séquence protéique calculées côté client.
// Fonctionnent pour toute séquence, avec ou sans entrée UniProt.

export type TMSegment = { start: number; end: number; label?: string };

export const STANDARD_AA = "ACDEFGHIKLMNPQRSTVWY";
const NON_STANDARD_AA = "BJOUXZ";
export const MAX_SEQUENCE_LENGTH = 100_000;

// ---------------------------------------------------------------------------
// Lecture et validation (séquence brute ou FASTA)
// ---------------------------------------------------------------------------

export type ParsedSequence = {
  header: string | null;
  sequence: string;
  warnings: string[];
};

export type ParseResult =
  | { ok: true; value: ParsedSequence }
  | { ok: false; error: string };

export function parseSequenceInput(text: string): ParseResult {
  const lines = text.replace(/\r/g, "").split("\n");
  const warnings: string[] = [];
  let header: string | null = null;
  let body: string[] = lines;

  const firstLine = lines.findIndex((l) => l.trim() !== "");
  if (firstLine !== -1 && lines[firstLine].trim().startsWith(">")) {
    header = lines[firstLine].trim().slice(1).trim() || null;
    const rest = lines.slice(firstLine + 1);
    const nextRecord = rest.findIndex((l) => l.trim().startsWith(">"));
    if (nextRecord !== -1) {
      const extra = rest.slice(nextRecord).filter((l) => l.trim().startsWith(">")).length;
      warnings.push(
        `${extra + 1} séquences détectées : seule la première est analysée.`
      );
      body = rest.slice(0, nextRecord);
    } else {
      body = rest;
    }
  }

  // Espaces et numéros de position (formats GenBank / EMBL) ignorés
  let sequence = body.join("").replace(/[\s\d]/g, "").toUpperCase();

  if (sequence.endsWith("*")) sequence = sequence.slice(0, -1);

  const gaps = (sequence.match(/[-.]/g) || []).length;
  if (gaps) {
    sequence = sequence.replace(/[-.]/g, "");
    warnings.push(`${gaps} caractère(s) d’alignement (« - » ou « . ») retiré(s).`);
  }

  if (!sequence) return { ok: false, error: "Aucune séquence détectée." };

  const invalid = Array.from(new Set(sequence.replace(/[A-Z]/g, "").split("")));
  if (invalid.length) {
    return {
      ok: false,
      error: `Caractère(s) non reconnu(s) : ${invalid.slice(0, 8).join(" ")}`,
    };
  }

  if (sequence.length > MAX_SEQUENCE_LENGTH) {
    return {
      ok: false,
      error: `Séquence trop longue (${sequence.length} résidus, maximum ${MAX_SEQUENCE_LENGTH}).`,
    };
  }

  const nucleotides = (sequence.match(/[ACGTUN]/g) || []).length;
  if (sequence.length >= 20 && nucleotides / sequence.length > 0.95) {
    return {
      ok: false,
      error:
        "La séquence ressemble à de l’ADN/ARN. Seules les séquences protéiques sont acceptées.",
    };
  }

  const nonStandard = sequence.split("").filter((aa) => NON_STANDARD_AA.includes(aa)).length;
  if (nonStandard) {
    warnings.push(
      `${nonStandard} résidu(s) non standard (B, J, O, U, X, Z) : exclus des calculs d’hydropathie et de charge.`
    );
  }

  if (sequence.length < 19) {
    warnings.push(
      "Séquence courte (< 19 résidus) : l’estimation des segments transmembranaires n’est pas possible."
    );
  }

  return { ok: true, value: { header, sequence, warnings } };
}

// ---------------------------------------------------------------------------
// Classes d’acides aminés
// ---------------------------------------------------------------------------

export const AA_CLASSES = [
  { key: "hydrophobic", label: "Hydrophobes", residues: "AVLIMFWP" },
  { key: "polar", label: "Polaires", residues: "GSTYC" },
  { key: "amide", label: "Amides", residues: "NQ" },
  { key: "basic", label: "Basiques", residues: "KRH" },
  { key: "acidic", label: "Acides", residues: "DE" },
] as const;

export function getAAColor(aa: string) {
  if ("AVLIMFWP".includes(aa)) return "bg-slate-200 text-slate-900";
  if ("GSTYC".includes(aa)) return "bg-emerald-100 text-emerald-900";
  if ("KRH".includes(aa)) return "bg-blue-100 text-blue-900";
  if ("DE".includes(aa)) return "bg-red-100 text-red-900";
  if ("NQ".includes(aa)) return "bg-purple-100 text-purple-900";
  return "bg-gray-100 text-gray-900";
}

// ---------------------------------------------------------------------------
// Composition et propriétés physico-chimiques (type ProtParam)
// ---------------------------------------------------------------------------

// Masses moyennes des résidus (acide aminé − H2O), en Da
const RESIDUE_MASS: Record<string, number> = {
  A: 71.0788, R: 156.1875, N: 114.1038, D: 115.0886, C: 103.1388,
  E: 129.1155, Q: 128.1307, G: 57.0519, H: 137.1411, I: 113.1594,
  L: 113.1594, K: 128.1741, M: 131.1926, F: 147.1766, P: 97.1167,
  S: 87.0782, T: 101.1051, W: 186.2132, Y: 163.176, V: 99.1326,
  U: 150.0388, O: 237.3018,
  B: 114.5962, Z: 128.6231, J: 113.1594,
};
const WATER_MASS = 18.01524;

// pKa (jeu EMBOSS)
const PKA = { nTerm: 8.6, cTerm: 3.6, C: 8.5, D: 3.9, E: 4.1, H: 6.5, K: 10.8, R: 12.5, Y: 10.1 };

export const KYTE_DOOLITTLE: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8,
  W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
};

export type Composition = { aa: string; count: number; percent: number }[];

export function countResidues(sequence: string) {
  const counts: Record<string, number> = {};
  for (const aa of sequence) counts[aa] = (counts[aa] ?? 0) + 1;
  return counts;
}

export function computeComposition(sequence: string): Composition {
  const counts = countResidues(sequence);
  return STANDARD_AA.split("").map((aa) => ({
    aa,
    count: counts[aa] ?? 0,
    percent: sequence.length ? ((counts[aa] ?? 0) / sequence.length) * 100 : 0,
  }));
}

export function netCharge(counts: Record<string, number>, pH: number) {
  const pos = (pKa: number) => 1 / (1 + 10 ** (pH - pKa));
  const neg = (pKa: number) => -1 / (1 + 10 ** (pKa - pH));
  return (
    pos(PKA.nTerm) +
    neg(PKA.cTerm) +
    (counts.K ?? 0) * pos(PKA.K) +
    (counts.R ?? 0) * pos(PKA.R) +
    (counts.H ?? 0) * pos(PKA.H) +
    (counts.D ?? 0) * neg(PKA.D) +
    (counts.E ?? 0) * neg(PKA.E) +
    (counts.C ?? 0) * neg(PKA.C) +
    (counts.Y ?? 0) * neg(PKA.Y)
  );
}

function isoelectricPoint(counts: Record<string, number>) {
  let low = 0;
  let high = 14;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (netCharge(counts, mid) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export type Properties = {
  length: number;
  molecularWeight: number;
  isoelectricPoint: number;
  chargeAtPH7: number;
  positive: number;
  negative: number;
  extinctionReduced: number;
  extinctionCystines: number;
  absorbance01: number;
  aliphaticIndex: number;
  gravy: number;
  unknownMass: number;
};

export function computeProperties(sequence: string): Properties {
  const counts = countResidues(sequence);
  const n = sequence.length;

  let mass = WATER_MASS;
  let unknownMass = 0;
  let kdSum = 0;
  let kdCount = 0;
  for (const aa of sequence) {
    if (RESIDUE_MASS[aa] !== undefined) mass += RESIDUE_MASS[aa];
    else unknownMass++;
    if (KYTE_DOOLITTLE[aa] !== undefined) {
      kdSum += KYTE_DOOLITTLE[aa];
      kdCount++;
    }
  }

  const molePercent = (aa: string) => ((counts[aa] ?? 0) / n) * 100;
  const extinctionReduced = (counts.W ?? 0) * 5500 + (counts.Y ?? 0) * 1490;
  const extinctionCystines = extinctionReduced + Math.floor((counts.C ?? 0) / 2) * 125;

  return {
    length: n,
    molecularWeight: mass,
    isoelectricPoint: isoelectricPoint(counts),
    chargeAtPH7: netCharge(counts, 7),
    positive: (counts.K ?? 0) + (counts.R ?? 0),
    negative: (counts.D ?? 0) + (counts.E ?? 0),
    extinctionReduced,
    extinctionCystines,
    absorbance01: mass ? extinctionCystines / mass : 0,
    aliphaticIndex:
      molePercent("A") + 2.9 * molePercent("V") + 3.9 * (molePercent("I") + molePercent("L")),
    gravy: kdCount ? kdSum / kdCount : 0,
    unknownMass,
  };
}

// ---------------------------------------------------------------------------
// Profil d’hydropathie (fenêtre glissante, valeur au centre de la fenêtre)
// ---------------------------------------------------------------------------

export type ProfilePoint = { position: number; score: number };

export function hydropathyProfile(sequence: string, windowSize: number): ProfilePoint[] {
  const n = sequence.length;
  if (n < windowSize) return [];

  const values = sequence.split("").map((aa) => KYTE_DOOLITTLE[aa]);
  const half = Math.floor(windowSize / 2);
  const points: ProfilePoint[] = [];

  let sum = 0;
  let known = 0;
  for (let i = 0; i < windowSize; i++) {
    if (values[i] !== undefined) {
      sum += values[i];
      known++;
    }
  }

  for (let start = 0; start + windowSize <= n; start++) {
    if (start > 0) {
      const out = values[start - 1];
      const inn = values[start + windowSize - 1];
      if (out !== undefined) {
        sum -= out;
        known--;
      }
      if (inn !== undefined) {
        sum += inn;
        known++;
      }
    }
    points.push({ position: start + half + 1, score: known ? sum / known : 0 });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Estimation des segments transmembranaires (Kyte & Doolittle, 1982)
// Fenêtre de 19 résidus, seuil 1,6 : régions hydrophobes compatibles avec une
// hélice transmembranaire. Méthode indicative, moins précise que DeepTMHMM.
// ---------------------------------------------------------------------------

export const TM_WINDOW = 19;
export const TM_THRESHOLD = 1.6;

export function estimateTMSegments(sequence: string): TMSegment[] {
  const profile = hydropathyProfile(sequence, TM_WINDOW);
  const segments: TMSegment[] = [];

  let runStart: number | null = null;
  let runEnd = 0;

  const close = () => {
    if (runStart === null) return;
    // Les centres au-dessus du seuil délimitent le segment ; un segment trop
    // court est élargi symétriquement à la longueur de la fenêtre.
    const missing = Math.max(0, TM_WINDOW - (runEnd - runStart + 1));
    let start = runStart - Math.floor(missing / 2);
    let end = runEnd + Math.ceil(missing / 2);
    if (start < 1) {
      end += 1 - start;
      start = 1;
    }
    end = Math.min(sequence.length, end);
    const last = segments[segments.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else segments.push({ start, end });
    runStart = null;
  };

  for (const p of profile) {
    if (p.score >= TM_THRESHOLD) {
      if (runStart === null) runStart = p.position;
      runEnd = p.position;
    } else {
      close();
    }
  }
  close();

  return segments.map((s, i) => ({ ...s, label: `TM${i + 1}` }));
}

// ---------------------------------------------------------------------------
// Règle « positive-inside » (von Heijne) : les boucles riches en K/R sont
// généralement cytoplasmiques. Indication d’orientation de l’extrémité N.
// ---------------------------------------------------------------------------

export type TopologyHint = {
  krNSide: number;
  krOtherSide: number;
  nTerminus: "in" | "out" | "unknown";
};

export function positiveInsideRule(
  sequence: string,
  segments: TMSegment[],
  flank = 15
): TopologyHint | null {
  if (!segments.length) return null;

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const loops: { start: number; end: number }[] = [];
  let prevEnd = 0;
  for (const seg of sorted) {
    loops.push({ start: prevEnd + 1, end: seg.start - 1 });
    prevEnd = seg.end;
  }
  loops.push({ start: prevEnd + 1, end: sequence.length });

  const countKR = (from: number, to: number) => {
    let c = 0;
    for (let p = Math.max(1, from); p <= Math.min(sequence.length, to); p++) {
      const aa = sequence[p - 1];
      if (aa === "K" || aa === "R") c++;
    }
    return c;
  };

  let krNSide = 0;
  let krOtherSide = 0;
  loops.forEach((loop, i) => {
    if (loop.end < loop.start) return;
    // Seuls les résidus proches des segments TM sont comptés
    const isFirst = i === 0;
    const isLast = i === loops.length - 1;
    let kr = 0;
    if (loop.end - loop.start + 1 <= 2 * flank) {
      kr = countKR(loop.start, loop.end);
    } else {
      if (!isFirst) kr += countKR(loop.start, loop.start + flank - 1);
      if (!isLast) kr += countKR(loop.end - flank + 1, loop.end);
    }
    if (i % 2 === 0) krNSide += kr;
    else krOtherSide += kr;
  });

  return {
    krNSide,
    krOtherSide,
    nTerminus: krNSide > krOtherSide ? "in" : krNSide < krOtherSide ? "out" : "unknown",
  };
}

// ---------------------------------------------------------------------------
// Recherche de motifs (syntaxe PROSITE simplifiée ou expression régulière)
// ---------------------------------------------------------------------------

export const MOTIF_PRESETS = [
  { label: "N-glycosylation", pattern: "N-{P}-[ST]-{P}", ref: "PS00001" },
  { label: "Phosphorylation PKC", pattern: "[ST]-x-[RK]", ref: "PS00005" },
  { label: "Phosphorylation CK2", pattern: "[ST]-x(2)-[DE]", ref: "PS00006" },
  { label: "N-myristoylation", pattern: "G-{EDRKHPFYW}-x(2)-[STAGCN]-{P}", ref: "PS00008" },
  { label: "Attachement cellulaire (RGD)", pattern: "R-G-D", ref: "PS00016" },
];

export function prositeToRegex(pattern: string): string {
  const p = pattern.trim().replace(/\.$/, "");
  // Sans tiret ni syntaxe PROSITE : traité comme une expression régulière
  if (!/[-{}]|x\(|^<|>$/i.test(p) && !/^[A-Z]+$/i.test(p)) return p.toUpperCase();

  return p
    .split("-")
    .map((token) => {
      let t = token.trim();
      let anchorStart = "";
      let anchorEnd = "";
      if (t.startsWith("<")) {
        anchorStart = "^";
        t = t.slice(1);
      }
      if (t.endsWith(">")) {
        anchorEnd = "$";
        t = t.slice(0, -1);
      }
      const repeat = t.match(/\((\d+)(?:,(\d+))?\)$/);
      let core = repeat ? t.slice(0, t.length - repeat[0].length) : t;
      if (/^x$/i.test(core)) core = ".";
      else if (core.startsWith("{")) core = `[^${core.slice(1, -1).toUpperCase()}]`;
      else core = core.toUpperCase();
      const quant = repeat ? `{${repeat[1]}${repeat[2] ? `,${repeat[2]}` : ""}}` : "";
      return `${anchorStart}${core}${quant}${anchorEnd}`;
    })
    .join("");
}

export type MotifHit = { start: number; end: number; match: string };

export function findMotif(
  sequence: string,
  pattern: string,
  limit = 2000
): { hits: MotifHit[]; error: string | null; truncated: boolean } {
  if (!pattern.trim()) return { hits: [], error: null, truncated: false };

  let regex: RegExp;
  try {
    // Recherche avec chevauchement grâce à l’anticipation
    regex = new RegExp(`(?=(${prositeToRegex(pattern)}))`, "g");
  } catch {
    return { hits: [], error: "Motif invalide.", truncated: false };
  }

  const hits: MotifHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(sequence)) !== null) {
    if (m[1]) hits.push({ start: m.index + 1, end: m.index + m[1].length, match: m[1] });
    regex.lastIndex = m.index + 1;
    if (hits.length >= limit) return { hits, error: null, truncated: true };
  }
  return { hits, error: null, truncated: false };
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

export function hashSequence(sequence: string) {
  let h = 5381;
  for (let i = 0; i < sequence.length; i++) h = ((h << 5) + h + sequence.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}${sequence.length.toString(36)}`;
}

export function toFasta(header: string, sequence: string) {
  const lines = sequence.match(/.{1,60}/g) ?? [];
  return `>${header}\n${lines.join("\n")}\n`;
}

export function downloadText(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
