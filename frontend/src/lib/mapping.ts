// Conversion de numérotation UniProt → structure PDB (SIFTS, via /api/mapping).

export type MappingSegment = {
  chain: string;
  unp_start: number;
  unp_end: number;
  offset: number;
  linear: boolean;
};

export type ResidueMapping = {
  pdb_id: string;
  accession: string;
  available: boolean;
  identity?: boolean;
  segments: MappingSegment[];
};

export type NumberedRange = {
  start: number;
  end: number;
  label?: string;
  color?: string;
  chain?: string;
  /** « pdb » : déjà dans la numérotation de la structure (Ramachandran, site actif…). */
  numbering?: "uniprot" | "pdb";
};

/**
 * Convertit une plage UniProt en plages de la structure (une par segment et
 * par chaîne). Renvoie [] si la région n'est pas présente dans la structure,
 * et la plage d'origine si aucune correspondance n'est connue.
 */
export function toStructureRanges(range: NumberedRange, mapping: ResidueMapping | null): NumberedRange[] {
  if (range.numbering === "pdb" || !mapping?.available) return [range];

  const out: NumberedRange[] = [];
  for (const seg of mapping.segments) {
    const lo = Math.max(range.start, seg.unp_start);
    const hi = Math.min(range.end, seg.unp_end);
    if (lo <= hi) {
      out.push({ ...range, start: lo + seg.offset, end: hi + seg.offset, chain: seg.chain, numbering: "pdb" });
    }
  }
  return out;
}

export function mapRanges(ranges: NumberedRange[], mapping: ResidueMapping | null): NumberedRange[] {
  return ranges.flatMap((r) => toStructureRanges(r, mapping));
}
