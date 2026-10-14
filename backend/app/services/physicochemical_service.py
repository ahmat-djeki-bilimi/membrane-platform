"""
Propriétés physico-chimiques d'une séquence protéique.

Masses moyennes des résidus et formules d'ExPASy ProtParam (Gasteiger et
al., 2005) ; pKa d'EMBOSS pour le point isoélectrique et la charge ;
hydropathie de Kyte & Doolittle (1982) ; indice aliphatique d'Ikai (1980).
Ce sont des valeurs calculées sur la séquence seule (sans modification
post-traductionnelle, peptide signal compris).
"""

from app.services.membrane_orientation_service import KYTE_DOOLITTLE

AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"
RESIDUE_MASS = {
    "A": 71.0788, "R": 156.1875, "N": 114.1038, "D": 115.0886, "C": 103.1388, "E": 129.1155, "Q": 128.1307,
    "G": 57.0519, "H": 137.1411, "I": 113.1594, "L": 113.1594, "K": 128.1741, "M": 131.1926, "F": 147.1766,
    "P": 97.1167, "S": 87.0782, "T": 101.1051, "W": 186.2132, "Y": 163.1760, "V": 99.1326,
}
WATER = 18.01524
# pKa (EMBOSS)
PKA_N_TERM, PKA_C_TERM = 8.6, 3.6
PKA_POSITIVE = {"K": 10.8, "R": 12.5, "H": 6.5}
PKA_NEGATIVE = {"D": 3.9, "E": 4.1, "C": 8.5, "Y": 10.1}
HYDROPHOBIC = set("AVILMFWC")
POLAR = set("STNQ")
CHARGED = set("DEKR")
AROMATIC = set("FWY")
PROFILE_WINDOW = 9


def net_charge(sequence: str, ph: float) -> float:
    counts = {a: sequence.count(a) for a in set(PKA_POSITIVE) | set(PKA_NEGATIVE)}
    positive = 1 / (1 + 10 ** (ph - PKA_N_TERM)) + sum(counts[a] / (1 + 10 ** (ph - pka)) for a, pka in PKA_POSITIVE.items())
    negative = 1 / (1 + 10 ** (PKA_C_TERM - ph)) + sum(counts[a] / (1 + 10 ** (pka - ph)) for a, pka in PKA_NEGATIVE.items())
    return positive - negative


def isoelectric_point(sequence: str) -> float:
    low, high = 0.0, 14.0
    for _ in range(60):
        middle = (low + high) / 2
        if net_charge(sequence, middle) > 0:
            low = middle
        else:
            high = middle
    return round((low + high) / 2, 2)


def hydropathy_profile(sequence: str, window: int = PROFILE_WINDOW) -> list[float | None]:
    """Moyenne glissante de Kyte-Doolittle, centrée sur chaque résidu."""
    values = [KYTE_DOOLITTLE.get(a) for a in sequence]
    half = window // 2
    profile: list[float | None] = []
    for k in range(len(sequence)):
        chunk = [v for v in values[max(0, k - half):k + half + 1] if v is not None]
        profile.append(round(sum(chunk) / len(chunk), 2) if chunk else None)
    return profile


def properties(sequence: str) -> dict:
    sequence = "".join(c for c in sequence.upper() if c.isalpha())
    n = len(sequence)
    standard = [c for c in sequence if c in RESIDUE_MASS]
    counts = {a: sequence.count(a) for a in AMINO_ACIDS}
    fraction = {a: counts[a] / n if n else 0.0 for a in AMINO_ACIDS}
    hydropathy = [KYTE_DOOLITTLE[c] for c in sequence if c in KYTE_DOOLITTLE]
    return {
        "length": n,
        "molecular_weight": round(sum(RESIDUE_MASS[c] for c in standard) + WATER, 1) if standard else None,
        "isoelectric_point": isoelectric_point(sequence) if n else None,
        "net_charge_ph7": round(net_charge(sequence, 7.0), 1) if n else None,
        "gravy": round(sum(hydropathy) / len(hydropathy), 3) if hydropathy else None,
        "aliphatic_index": round(100 * (fraction["A"] + 2.9 * fraction["V"] + 3.9 * (fraction["I"] + fraction["L"])), 1),
        "aromatic_fraction": round(sum(fraction[a] for a in AROMATIC), 3),
        "hydrophobic_fraction": round(sum(fraction[a] for a in HYDROPHOBIC), 3),
        "polar_fraction": round(sum(fraction[a] for a in POLAR), 3),
        "charged_fraction": round(sum(fraction[a] for a in CHARGED), 3),
        "positive": counts["K"] + counts["R"],
        "negative": counts["D"] + counts["E"],
        "cysteines": counts["C"],
        "composition": {a: round(100 * fraction[a], 2) for a in AMINO_ACIDS},
        "nonstandard": n - len(standard),
        "hydropathy_profile": hydropathy_profile(sequence),
    }
