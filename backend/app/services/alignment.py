"""
Alignement de séquences protéiques en Python pur (aucune dépendance compilée).

Alignement semi-global (extrémités libres) à pénalités de gaps affines
(algorithme de Gotoh), matrice BLOSUM62, limité à une bande autour de la
diagonale. Chaque homologue est aligné sur la séquence étudiée : on obtient un
alignement multiple « ancré » sur celle-ci, adapté au calcul de la
conservation de chacun de ses résidus.
"""

from dataclasses import dataclass

_ORDER = "ARNDCQEGHILKMFPSTWYVBZX"
_BLOSUM62_ROWS = """
 4 -1 -2 -2  0 -1 -1  0 -2 -1 -1 -1 -1 -2 -1  1  0 -3 -2  0 -2 -1  0
-1  5  0 -2 -3  1  0 -2  0 -3 -2  2 -1 -3 -2 -1 -1 -3 -2 -3 -1  0 -1
-2  0  6  1 -3  0  0  0  1 -3 -3  0 -2 -3 -2  1  0 -4 -2 -3  3  0 -1
-2 -2  1  6 -3  0  2 -1 -1 -3 -4 -1 -3 -3 -1  0 -1 -4 -3 -3  4  1 -1
 0 -3 -3 -3  9 -3 -4 -3 -3 -1 -1 -3 -1 -2 -3 -1 -1 -2 -2 -1 -3 -3 -2
-1  1  0  0 -3  5  2 -2  0 -3 -2  1  0 -3 -1  0 -1 -2 -1 -2  0  3 -1
-1  0  0  2 -4  2  5 -2  0 -3 -3  1 -2 -3 -1  0 -1 -3 -2 -2  1  4 -1
 0 -2  0 -1 -3 -2 -2  6 -2 -4 -4 -2 -3 -3 -2  0 -2 -2 -3 -3 -1 -2 -1
-2  0  1 -1 -3  0  0 -2  8 -3 -3 -1 -2 -1 -2 -1 -2 -2  2 -3  0  0 -1
-1 -3 -3 -3 -1 -3 -3 -4 -3  4  2 -3  1  0 -3 -2 -1 -3 -1  3 -3 -3 -1
-1 -2 -3 -4 -1 -2 -3 -4 -3  2  4 -2  2  0 -3 -2 -1 -2 -1  1 -4 -3 -1
-1  2  0 -1 -3  1  1 -2 -1 -3 -2  5 -1 -3 -1  0 -1 -3 -2 -2  0  1 -1
-1 -1 -2 -3 -1  0 -2 -3 -2  1  2 -1  5  0 -2 -1 -1 -1 -1  1 -3 -1 -1
-2 -3 -3 -3 -2 -3 -3 -3 -1  0  0 -3  0  6 -4 -2 -2  1  3 -1 -3 -3 -1
-1 -2 -2 -1 -3 -1 -1 -2 -2 -3 -3 -1 -2 -4  7 -1 -1 -4 -3 -2 -2 -1 -2
 1 -1  1  0 -1  0  0  0 -1 -2 -2  0 -1 -2 -1  4  1 -3 -2 -2  0  0  0
 0 -1  0 -1 -1 -1 -1 -2 -2 -1 -1 -1 -1 -2 -1  1  5 -2 -2  0 -1 -1  0
-3 -3 -4 -4 -2 -2 -3 -2 -2 -3 -2 -3 -1  1 -4 -3 -2 11  2 -3 -4 -3 -2
-2 -2 -2 -3 -2 -1 -2 -3  2 -1 -1 -2 -1  3 -3 -2 -2  2  7 -1 -3 -2 -1
 0 -3 -3 -3 -1 -2 -2 -3 -3  3  1 -2  1 -1 -2 -2  0 -3 -1  4 -3 -2 -1
-2 -1  3  4 -3  0  1 -1  0 -3 -4  0 -3 -3 -2  0 -1 -4 -3 -3  4  1 -1
-1  0  0  1 -3  3  4 -2  0 -3 -3  1 -1 -3 -1  0 -1 -3 -2 -2  1  4 -1
 0 -1 -1 -1 -2 -1 -1 -1 -1 -1 -1 -1 -1 -1 -2  0  0 -2 -1 -1 -1 -1 -1
"""

BLOSUM62: dict[str, dict[str, int]] = {}
for _a, _row in zip(_ORDER, _BLOSUM62_ROWS.strip().splitlines()):
    BLOSUM62[_a] = {_b: int(v) for _b, v in zip(_ORDER, _row.split())}

# Résidus rares ramenés aux 20 standard (ou X)
_NORMALIZE = str.maketrans({"U": "C", "O": "K", "J": "L"})

GAP_OPEN = -11
GAP_EXTEND = -1
_NEG = float("-inf")


@dataclass
class PairAlignment:
    # Résidu de l'homologue aligné sur chaque position de la séquence étudiée
    # ("-" si aucun) : alignement ancré sur la séquence étudiée.
    anchored: str
    identity: float  # identité sur les positions alignées
    coverage: float  # fraction de la séquence étudiée alignée
    score: int


def _clean(sequence: str) -> str:
    seq = sequence.upper().translate(_NORMALIZE)
    return "".join(c if c in BLOSUM62 else "X" for c in seq if c.isalpha())


def align_to_query(query: str, subject: str, band: int = 100) -> PairAlignment:
    """Alignement semi-global de `subject` sur `query` (gaps affines, bande)."""
    a, b = _clean(query), _clean(subject)
    n, m = len(a), len(b)
    if not n or not m:
        return PairAlignment("-" * n, 0.0, 0.0, 0)

    go, ge = GAP_OPEN + GAP_EXTEND, GAP_EXTEND
    lo = min(0, m - n) - band  # bornes de j - i
    hi = max(0, m - n) + band
    width = hi - lo + 1

    # Lignes de la bande : index k = j - i - lo
    # États : M (paire), X (résidu de la requête face à un gap), Y (gap dans la requête)
    prev_m = [_NEG] * width
    prev_x = [_NEG] * width
    prev_y = [_NEG] * width
    # Ligne 0 : début libre dans le sujet (j > 0)
    for k in range(width):
        j = k + lo
        if j == 0:
            prev_m[k] = 0.0
        elif 0 < j <= m:
            prev_y[k] = 0.0

    trace_m: list[bytearray] = [bytearray(width)]
    trace_x: list[bytearray] = [bytearray(width)]
    trace_y: list[bytearray] = [bytearray(width)]
    last_row = (prev_m, prev_x, prev_y)
    best = (_NEG, 0, 0, 0)  # score, i, j, état
    if m >= 0:
        for k in range(width):
            if k + lo == m:
                best = (max(prev_m[k], prev_y[k]), 0, m, 0 if prev_m[k] >= prev_y[k] else 2)

    for i in range(1, n + 1):
        cur_m = [_NEG] * width
        cur_x = [_NEG] * width
        cur_y = [_NEG] * width
        tm, tx, ty = bytearray(width), bytearray(width), bytearray(width)
        row_scores = BLOSUM62[a[i - 1]]
        for k in range(width):
            j = i + k + lo
            if j < 0 or j > m:
                continue
            if j == 0:
                cur_x[k] = 0.0  # début libre dans la requête
                continue
            # M : diagonale (même k sur la ligne précédente)
            pm, px, py = prev_m[k], prev_x[k], prev_y[k]
            if pm >= px and pm >= py:
                cur_m[k], tm[k] = pm + row_scores[b[j - 1]], 0
            elif px >= py:
                cur_m[k], tm[k] = px + row_scores[b[j - 1]], 1
            else:
                cur_m[k], tm[k] = py + row_scores[b[j - 1]], 2
            # X : ligne précédente, même j (k + 1)
            if k + 1 < width:
                o1, o2, o3 = prev_m[k + 1] + go, prev_x[k + 1] + ge, prev_y[k + 1] + go
                if o1 >= o2 and o1 >= o3:
                    cur_x[k], tx[k] = o1, 0
                elif o2 >= o3:
                    cur_x[k], tx[k] = o2, 1
                else:
                    cur_x[k], tx[k] = o3, 2
            # Y : même ligne, j - 1 (k - 1)
            if k > 0:
                o1, o2, o3 = cur_m[k - 1] + go, cur_x[k - 1] + go, cur_y[k - 1] + ge
                if o1 >= o2 and o1 >= o3:
                    cur_y[k], ty[k] = o1, 0
                elif o3 >= o2:
                    cur_y[k], ty[k] = o3, 2
                else:
                    cur_y[k], ty[k] = o2, 1
            # Fin libre : dernière colonne du sujet
            if j == m:
                for state, value in ((0, cur_m[k]), (1, cur_x[k]), (2, cur_y[k])):
                    if value > best[0]:
                        best = (value, i, j, state)
        trace_m.append(tm)
        trace_x.append(tx)
        trace_y.append(ty)
        prev_m, prev_x, prev_y = cur_m, cur_x, cur_y
        last_row = (cur_m, cur_x, cur_y)

    # Fin libre : dernière ligne de la requête
    for k in range(width):
        j = n + k + lo
        if 0 <= j <= m:
            for state, value in ((0, last_row[0][k]), (1, last_row[1][k]), (2, last_row[2][k])):
                if value > best[0]:
                    best = (value, n, j, state)

    score, i, j, state = best
    anchored = ["-"] * n
    while i > 0 and j > 0:
        k = j - i - lo
        if state == 0:
            anchored[i - 1] = b[j - 1]
            state = trace_m[i][k]
            i, j = i - 1, j - 1
        elif state == 1:
            state = trace_x[i][k]
            i -= 1
        else:
            state = trace_y[i][k]
            j -= 1

    aligned = [(q, s) for q, s in zip(a, anchored) if s != "-"]
    identity = sum(q == s for q, s in aligned) / len(aligned) if aligned else 0.0
    return PairAlignment("".join(anchored), identity, len(aligned) / n, int(score))
