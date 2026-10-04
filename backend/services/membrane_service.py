import os
import re
import tempfile
from typing import Dict, List, Optional

import biolib
from fastapi import HTTPException

from services.uniprot_service import fetch_uniprot_entry


def _extract_prediction_summary(result_text: str) -> Dict:
    predicted_type: Optional[str] = None
    tm_segments: List[Dict] = []
    is_membrane = False

    # 1) Nombre de segments TM
    tm_count_match = re.search(
        r"Number of predicted TM(?:Rs|s)\s*:\s*(\d+)",
        result_text,
        flags=re.IGNORECASE,
    )
    tm_count = int(tm_count_match.group(1)) if tm_count_match else 0

    # 2) Type réel
    # On cherche seulement des lignes utiles, pas juste le mot "transmembrane" partout
    if re.search(r"\bglobular\b", result_text, flags=re.IGNORECASE):
        predicted_type = "Globular protein"
        is_membrane = False
    elif re.search(r"\bbeta[- ]barrel\b", result_text, flags=re.IGNORECASE):
        predicted_type = "Beta-barrel membrane protein"
        is_membrane = True
    elif re.search(r"\balpha\b", result_text, flags=re.IGNORECASE) and tm_count > 0:
        predicted_type = "Alpha-helical membrane protein"
        is_membrane = True
    elif tm_count > 0:
        predicted_type = "Transmembrane protein"
        is_membrane = True
    else:
        predicted_type = "Non-membrane protein"
        is_membrane = False

    # 3) Segments TM
    # Si le fichier contient de vrais intervalles, on les récupère
    gff_matches = re.findall(
        r"\tTMhelix\t(\d+)\t(\d+)\t",
        result_text,
        flags=re.IGNORECASE,
    )

    seen = set()
    for start, end in gff_matches:
        s = int(start)
        e = int(end)
        if s < e and (s, e) not in seen:
            seen.add((s, e))
            tm_segments.append(
                {
                    "start": s,
                    "end": e,
                    "label": "TM",
                }
            )

    # 4) Si DeepTMHMM annonce des TM mais qu'on n'a pas réussi à lire les positions
    # on crée juste des placeholders pour garder le bon nombre
    if tm_count > 0 and len(tm_segments) == 0:
        for i in range(tm_count):
            tm_segments.append(
                {
                    "start": 0,
                    "end": 0,
                    "label": f"TM_{i+1}",
                }
            )

    return {
        "is_membrane": is_membrane,
        "predicted_type": predicted_type,
        "tm_segments": tm_segments,
        "raw_output": result_text,
    }


def _find_result_text(output_dir: str) -> str:
    collected_texts: List[str] = []

    for root, _, files in os.walk(output_dir):
        for file_name in files:
            lower_name = file_name.lower()

            if lower_name.endswith((".txt", ".gff3", ".gff", ".md")):
                file_path = os.path.join(root, file_name)
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()
                        if text.strip():
                            collected_texts.append(
                                f"\n===== FILE: {file_name} =====\n{text}\n"
                            )
                except OSError:
                    continue

    return "\n".join(collected_texts).strip()


def run_deeptmhmm_for_accession(accession: str) -> Dict:
    uniprot_data = fetch_uniprot_entry(accession)
    sequence = uniprot_data.get("sequence", "")
    accession_value = uniprot_data.get("accession") or accession.upper()

    if not sequence:
        raise HTTPException(
            status_code=400,
            detail="No sequence available for DeepTMHMM."
        )

    fasta_content = f">{accession_value}\n{sequence}\n"

    temp_fasta_path: Optional[str] = None
    output_dir: Optional[str] = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".fasta",
            delete=False,
            encoding="utf-8"
        ) as temp_fasta:
            temp_fasta.write(fasta_content)
            temp_fasta_path = temp_fasta.name

        output_dir = tempfile.mkdtemp(prefix="deeptmhmm_output_")

        app = biolib.load("DTU/DeepTMHMM")
        job = app.run(fasta=temp_fasta_path)

        job.save_files(output_dir=output_dir)

        result_text = _find_result_text(output_dir)

        if not result_text:
            stdout_raw = job.get_stdout()
            stderr_raw = job.get_stderr()

            stdout_text = (
                stdout_raw.decode("utf-8", errors="ignore")
                if isinstance(stdout_raw, bytes)
                else str(stdout_raw)
            )
            stderr_text = (
                stderr_raw.decode("utf-8", errors="ignore")
                if isinstance(stderr_raw, bytes)
                else str(stderr_raw)
            )

            raise HTTPException(
                status_code=502,
                detail=(
                    "DeepTMHMM completed but no parsable output file was found. "
                    f"STDOUT: {stdout_text} | STDERR: {stderr_text}"
                ),
            )

        parsed = _extract_prediction_summary(result_text)

        return {
            "accession": accession_value,
            "is_membrane": parsed["is_membrane"],
            "predicted_type": parsed["predicted_type"],
            "tm_segments": parsed["tm_segments"],
            "raw_output": parsed["raw_output"],
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"DeepTMHMM execution failed: {exc}"
        ) from exc
    finally:
        if temp_fasta_path and os.path.exists(temp_fasta_path):
            try:
                os.remove(temp_fasta_path)
            except OSError:
                pass