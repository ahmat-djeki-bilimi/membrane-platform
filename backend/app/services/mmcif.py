"""
Lecture minimale du format mmCIF (atomes et noms des molécules), pour les
structures que le PDB ne distribue pas au format PDB (plus de 99 999 atomes,
identifiants de chaîne de plusieurs caractères).

Les atomes sont rendus sous la même forme que la lecture des fichiers PDB, y
compris une ligne au format PDB : les chaînes à plusieurs caractères y
reçoivent un identifiant d'un caractère (la chaîne d'origine reste dans
« chain »), pour que les visionneuses qui lisent le format PDB les affichent.
"""

import re
import string

import numpy as np

_TOKEN = re.compile(r"""'(?:[^']|'(?=\S))*'|"(?:[^"]|"(?=\S))*"|\S+""")
CHAIN_LETTERS = string.ascii_uppercase + string.ascii_lowercase + string.digits


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def read_categories(text: str, wanted: set[str]) -> dict[str, dict[str, list[str]]]:
    """
    Colonnes des catégories demandées (« _atom_site », « _entity »…), en
    boucle (loop_) ou en paires clé-valeur.
    """
    tables: dict[str, dict[str, list[str]]] = {}
    lines = text.splitlines()
    i, n = 0, len(lines)

    def tokens_from(start: int) -> tuple[list[str], int]:
        """Valeurs à partir de la ligne `start` (gère les blocs « ; … ; »)."""
        line = lines[start]
        if line.startswith(";"):
            block = [line[1:]]
            j = start + 1
            while j < n and not lines[j].startswith(";"):
                block.append(lines[j])
                j += 1
            return ["\n".join(block).strip()], j + 1
        return [_unquote(t) for t in _TOKEN.findall(line)], start + 1

    while i < n:
        line = lines[i].strip()
        if line == "loop_":
            i += 1
            tags = []
            while i < n and lines[i].startswith("_"):
                tags.append(lines[i].strip())
                i += 1
            category = tags[0].split(".")[0] if tags else ""
            keep = category in wanted
            columns: list[list[str]] = [[] for _ in tags]
            buffer: list[str] = []
            while i < n:
                stripped = lines[i].strip()
                if not stripped or stripped.startswith(("_", "loop_", "data_")) or stripped == "#":
                    break
                values, i = tokens_from(i)
                if keep:
                    buffer.extend(values)
                    while len(buffer) >= len(tags):
                        for k in range(len(tags)):
                            columns[k].append(buffer[k])
                        buffer = buffer[len(tags):]
            if keep:
                tables[category] = {tag.split(".", 1)[1]: col for tag, col in zip(tags, columns)}
            continue
        if line.startswith("_") and "." in line:
            category = line.split(".")[0]
            if category in wanted:
                parts = _TOKEN.findall(line)
                key = parts[0].split(".", 1)[1]
                if len(parts) > 1:
                    value = _unquote(parts[1])
                    i += 1
                else:
                    values, i = tokens_from(i + 1)
                    value = values[0] if values else ""
                tables.setdefault(category, {})[key] = [value]
                continue
        i += 1
    return tables


def chain_aliases(chains: list[str]) -> dict[str, str]:
    """Identifiant d'un caractère pour chaque chaîne (inchangé s'il en a déjà un)."""
    aliases = {c: c for c in chains if len(c) == 1}
    free = [c for c in CHAIN_LETTERS if c not in aliases.values()]
    for k, chain in enumerate(c for c in chains if len(c) != 1):
        # Au-delà de 62 chaînes, les identifiants sont réutilisés (affichage seulement)
        aliases[chain] = free[k % len(free)] if free else chain[0]
    return aliases


def pdb_line(record, serial, name, resn, chain, resi, icode, xyz, occupancy, b, element) -> str:
    """Ligne ATOM/HETATM au format PDB (colonnes fixes)."""
    atom_name = f" {name:<3}" if len(name) < 4 and len(element) == 1 else f"{name:<4}"
    x, y, z = xyz
    return (
        f"{record:<6}{serial % 100000:5d} {atom_name[:4]} {resn[:3]:>3} {chain[:1]}{resi:4d}{(icode or ' ')[:1]}   "
        f"{x:8.3f}{y:8.3f}{z:8.3f}{occupancy:6.2f}{b:6.2f}          {element[:2]:>2}"
    )


def parse_mmcif(text: str) -> tuple[list[dict], dict[str, str]]:
    """Atomes du premier modèle (première conformation alternative) et nom de la molécule de chaque chaîne."""
    tables = read_categories(text, {"_atom_site", "_entity"})
    site = tables.get("_atom_site", {})
    if not site:
        return [], {}
    count = len(site["Cartn_x"])
    col = lambda key, fallback=None: site.get(key) or site.get(fallback) or ["?"] * count  # noqa: E731

    group, models = col("group_PDB"), col("pdbx_PDB_model_num")
    names, alts = col("auth_atom_id", "label_atom_id"), col("label_alt_id")
    resns, chains = col("auth_comp_id", "label_comp_id"), col("auth_asym_id", "label_asym_id")
    seq_ids, icodes = col("auth_seq_id", "label_seq_id"), col("pdbx_PDB_ins_code")
    xs, ys, zs = site["Cartn_x"], site["Cartn_y"], site["Cartn_z"]
    occupancies, bs = col("occupancy"), col("B_iso_or_equiv")
    elements, entities = col("type_symbol"), col("label_entity_id")

    first_model = models[0]
    aliases = chain_aliases(sorted(set(chains)))
    atoms, entity_of_chain = [], {}
    for k in range(count):
        if models[k] != first_model:
            break
        if alts[k] not in (".", "?", "A"):
            continue
        try:
            resi = int(seq_ids[k])
        except ValueError:
            continue
        if not -999 <= resi <= 9999:
            continue
        record = "HETATM" if group[k] == "HETATM" else "ATOM"
        icode = "" if icodes[k] in (".", "?") else icodes[k]
        xyz = (float(xs[k]), float(ys[k]), float(zs[k]))
        occupancy = float(occupancies[k]) if occupancies[k] not in (".", "?") else 1.0
        b = float(bs[k]) if bs[k] not in (".", "?") else 0.0
        element = elements[k] if elements[k] not in (".", "?") else names[k][:1]
        chain = chains[k]
        entity_of_chain.setdefault(chain, entities[k])
        atoms.append(
            {
                "record": record,
                "name": names[k],
                "resn": resns[k],
                "chain": chain,
                "resi": resi,
                "icode": icode,
                "coord": np.array(xyz),
                "element": element,
                "line": pdb_line(record, len(atoms) + 1, names[k], resns[k], aliases[chain], resi, icode, xyz, occupancy, b, element),
            }
        )

    entity = tables.get("_entity", {})
    descriptions = dict(zip(entity.get("id", []), entity.get("pdbx_description", [])))
    molecules = {
        chain: descriptions[e]
        for chain, e in entity_of_chain.items()
        if descriptions.get(e) not in (None, "?", ".")
    }
    return atoms, molecules
