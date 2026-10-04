import re
from html import unescape
import requests


def _clean_text(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _num(text: str, names):
    for name in names:
        m = re.search(rf"{name}\s*[:=]?\s*(-?\d+(?:\.\d+)?)", text, flags=re.I)
        if m:
            return float(m.group(1))
    return None


def _membrane_type(text: str):
    low = text.lower()
    if "alpha-helical" in low or "transmembrane" in low:
        return "Transmembrane protein"
    if "peripheral" in low:
        return "Peripheral membrane protein"
    if "monotopic" in low:
        return "Monotopic membrane protein"
    return "Membrane-associated protein"


def get_opm_data(pdb_id: str) -> dict:
    pdb_id_clean = pdb_id.lower().strip()
    url = f"https://opm.phar.umich.edu/proteins/{pdb_id_clean}"

    result = {
        "pdb_id": pdb_id.upper(),
        "available": False,
        "url": url,
        "membrane_type": None,
        "hydrophobic_thickness": None,
        "tilt_angle": None,
        "delta_g_transfer": None,
        "message": "OPM data not available.",
        "interpretation": "",
    }

    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": "MemProtScope"})
        result["http_status"] = r.status_code

        if r.status_code != 200:
            result["message"] = f"OPM returned HTTP {r.status_code}."
            result["interpretation"] = "Aucune donnée OPM exploitable n’a été récupérée."
            return result

        text = _clean_text(r.text)
        low = text.lower()

        available = (
            pdb_id_clean in low
            and "not found" not in low
            and "page not found" not in low
        )

        thickness = _num(text, ["Hydrophobic thickness", "Thickness", "Membrane thickness"])
        tilt = _num(text, ["Tilt angle", "Tilt"])
        delta_g = _num(text, ["Transfer energy", "DeltaG", "Delta G", "dG"])

        mtype = _membrane_type(text)

        result.update({
            "available": available,
            "membrane_type": mtype,
            "hydrophobic_thickness": thickness,
            "tilt_angle": tilt,
            "delta_g_transfer": delta_g,
            "message": "OPM entry detected and parsed." if available else "OPM page reached but no clear entry was detected.",
        })

        parts = [f"La structure est associée à la membrane comme {mtype.lower()}."]
        if thickness is not None:
            parts.append(f"L’épaisseur hydrophobe estimée est de {thickness} Å.")
        if tilt is not None:
            parts.append(f"L’angle d’inclinaison estimé est de {tilt}°.")
        if delta_g is not None:
            parts.append(f"Le ΔG de transfert membranaire est estimé à {delta_g} kcal/mol.")
        result["interpretation"] = " ".join(parts)

        return result

    except Exception as e:
        result["error"] = str(e)
        result["interpretation"] = "Impossible de récupérer les données OPM."
        return result
