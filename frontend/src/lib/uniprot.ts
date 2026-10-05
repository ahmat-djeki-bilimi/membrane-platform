// Format officiel des accessions UniProtKB
const UNIPROT_ACCESSION =
  /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

export function normalizeAccession(value: string) {
  return value.trim().toUpperCase();
}

export function isValidAccession(value: string) {
  return UNIPROT_ACCESSION.test(normalizeAccession(value));
}

export const EXAMPLE_ACCESSIONS = [
  { accession: "P07550", name: "Récepteur β2-adrénergique" },
  { accession: "P29972", name: "Aquaporine-1" },
  { accession: "P0A334", name: "Canal potassique KcsA" },
  { accession: "P02945", name: "Bactériorhodopsine" },
];
