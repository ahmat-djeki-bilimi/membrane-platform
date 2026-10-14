"""
Rapport scientifique d'une exécution, au format PDF (reportlab).

Le rapport reprend tout ce qui permet de comprendre et de refaire l'analyse :
entrées, versions des sources de données, méthodes et références, paramètres,
étapes du pipeline, résultats principaux, avertissements et erreurs.
"""

import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services import runs

# Caractères absents des polices PDF standard (WinAnsi) : équivalents lisibles
_REPLACEMENTS = {"≥": ">=", "≤": "<=", "Δ": "delta ", "→": "->", "←": "<-", "−": "-", "↔": "<->", "≈": "~", "★": "*", "✓": "ok", "φ": "phi", "ψ": "psi", "α": "alpha", "β": "beta", "χ": "chi", "√": "racine "}

STATUS = {"succeeded": "terminée", "failed": "en échec", "running": "en cours", "queued": "en file d’attente"}


def safe(value) -> str:
    text = "" if value is None else str(value)
    for char, replacement in _REPLACEMENTS.items():
        text = text.replace(char, replacement)
    text = text.encode("cp1252", errors="replace").decode("cp1252")
    return escape(text)


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=base["Title"], fontSize=17, leading=21, alignment=TA_LEFT, spaceAfter=4),
        "subtitle": ParagraphStyle("subtitle", parent=base["Normal"], fontSize=9.5, textColor=colors.HexColor("#475569"), spaceAfter=8),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontSize=12.5, leading=15, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#0f4c81")),
        "body": ParagraphStyle("body", parent=base["Normal"], fontSize=9, leading=12),
        "small": ParagraphStyle("small", parent=base["Normal"], fontSize=8, leading=10, textColor=colors.HexColor("#475569")),
        "cell": ParagraphStyle("cell", parent=base["Normal"], fontSize=8, leading=10),
    }


def _table(rows: list[list], widths: list[float], styles: dict, header: bool = True) -> Table:
    data = [[Paragraph(safe(c) if not isinstance(c, Paragraph) else c.text, styles["cell"]) for c in row] for row in rows]
    table = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        commands.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")))
    table.setStyle(TableStyle(commands))
    return table


def _date(value: str | None) -> str:
    if not value:
        return "—"
    try:
        return datetime.fromisoformat(value).strftime("%d/%m/%Y %H:%M:%S UTC")
    except ValueError:
        return value


def build_report(job: dict) -> bytes:
    styles = _styles()
    provenance = job.get("provenance") or {}
    result = job.get("result") or {}
    story = []
    p = lambda text, style="body": story.append(Paragraph(safe(text), styles[style]))  # noqa: E731

    p("Rapport d’analyse — MemProtScope", "title")
    p(f"{runs.KIND_LABELS.get(job['kind'], job['kind'])} · exécution {job['id']} · rapport généré le {datetime.now(timezone.utc).strftime('%d/%m/%Y à %H:%M UTC')}", "subtitle")

    # 1. Identification
    p("1. Identification de l’exécution", "h2")
    started, finished = job.get("started_at"), job.get("finished_at")
    duration = provenance.get("duration")
    story.append(
        _table(
            [
                ["Champ", "Valeur"],
                ["Identifiant", job["id"]],
                ["Type d’analyse", runs.KIND_LABELS.get(job["kind"], job["kind"])],
                ["Statut", STATUS.get(job["status"], job["status"])],
                ["Créée / démarrée / terminée", f"{_date(job.get('created_at'))} / {_date(started)} / {_date(finished)}"],
                ["Durée du calcul", f"{duration} s" if duration is not None else "—"],
                ["Tentatives", job.get("attempts")],
                ["Empreinte des entrées et paramètres", provenance.get("fingerprint") or "—"],
                ["Nouvelle exécution de", job.get("parent_id") or "—"],
            ],
            [55, 115],
            styles,
        )
    )

    # 2. Entrées
    p("2. Données d’entrée", "h2")
    inputs = (provenance.get("declared_inputs") or runs.declared_inputs(job["kind"], job.get("params") or {})) + provenance.get("inputs", [])
    if inputs:
        story.append(_table([["Type", "Identifiant", "Détails"]] + [[i["kind"], i["id"], ", ".join(f"{k} : {v}" for k, v in i.items() if k not in ("kind", "id"))] for i in inputs], [35, 55, 80], styles))
    else:
        p("Aucune entrée déclarée.")

    # 3. Sources et versions
    p("3. Sources de données et versions", "h2")
    sources = provenance.get("sources", [])
    if sources:
        story.append(
            _table(
                [["Source", "Version (release)", "Requêtes directes", "Réponses du cache", "Requêtes en échec", "Cache le plus ancien"]]
                + [
                    [
                        s["name"],
                        f"{s.get('release') or '—'}{' (' + s['release_date'] + ')' if s.get('release_date') else ''}",
                        s["live_requests"],
                        s["cached_responses"],
                        f"{s.get('failed_requests', 0)}{' : ' + s['last_error'][:80] if s.get('last_error') else ''}",
                        _date(s.get("oldest_cache")),
                    ]
                    for s in sources
                ],
                [32, 30, 20, 20, 38, 30],
                styles,
            )
        )
        p(
            "Les réponses du cache ont été obtenues à la date indiquée : elles reflètent la version de la base à ce moment-là. "
            "La version (release) n’est connue que si le service la communique (UniProt) lors d’une requête directe.",
            "small",
        )
    else:
        p("Aucune source externe enregistrée (exécution antérieure à la traçabilité, ou calcul sans données externes).")

    # 4. Méthodes, outils, environnement
    p("4. Méthodes, outils et environnement", "h2")
    methods = provenance.get("methods") or runs.methods(job["kind"], job.get("params") or {})
    if methods:
        story.append(_table([["Méthode ou outil", "Références", "Version de méthode (plateforme)"]] + [[m["name"], m.get("reference") or "", m.get("platform_version") or "—"] for m in methods], [85, 60, 25], styles))
    env = provenance.get("environment") or {}
    if env:
        p("Environnement : " + " · ".join(f"{k} {v}" for k, v in env.items()), "small")

    # 5. Paramètres
    p("5. Paramètres", "h2")
    params = runs._flatten(job.get("params") or {})
    story.append(_table([["Paramètre", "Valeur"]] + [[k, v] for k, v in params.items()], [55, 115], styles) if params else Paragraph("Aucun paramètre.", styles["body"]))

    # 6. Étapes
    p("6. Étapes du pipeline", "h2")
    steps = provenance.get("steps", [])
    if steps:
        story.append(
            _table(
                [["Étape", "Statut", "Durée (s)", "Réponses du cache", "Erreur"]] + [[s["name"], STATUS.get(s["status"], s["status"]), s.get("duration"), s.get("cache_hits"), s.get("error") or ""] for s in steps],
                [55, 22, 18, 25, 50],
                styles,
            )
        )
    else:
        p("Étapes non enregistrées pour cette exécution.")

    # 7. Résultats
    p("7. Résultats principaux", "h2")
    summary = runs.summarize(job["kind"], result)
    if summary:
        story.append(_table([["Indicateur", "Valeur"]] + [[k, v] for k, v in summary.items()], [70, 100], styles))
    if job["kind"] == "explorer" and result.get("candidates"):
        story.append(Spacer(1, 4))
        p("Positions candidates (hypothèses à tester expérimentalement, pas des preuves) :", "body")
        story.append(
            _table(
                [["Position", "Grade", "Catégorie", "Raisons"]] + [[f"{c['residue']}{c['position']}", c["grade"], c["category"], " ; ".join(c["reasons"])[:300]] for c in result["candidates"][:20]],
                [18, 14, 30, 108],
                styles,
            )
        )
    for note in result.get("interpretation", []) if isinstance(result, dict) else []:
        p(f"{note['title']} : {note['text']}", "small")

    # 8. Avertissements et erreurs
    p("8. Avertissements et erreurs", "h2")
    warnings = result.get("warnings", []) if isinstance(result, dict) else []
    issues = [f"Avertissement : {w}" for w in warnings]
    if job.get("error"):
        issues.append(f"Erreur de l’exécution : {job['error']}")
    for attempt in job.get("history") or []:
        issues.append(f"Tentative {attempt.get('attempt')} ({_date(attempt.get('finished_at'))}) : {attempt.get('error') or attempt.get('status')}")
    if issues:
        for issue in issues:
            p(f"• {issue}")
    else:
        p("Aucun avertissement ni erreur.")

    # 9. Reproductibilité
    p("9. Reproductibilité", "h2")
    story.append(
        KeepTogether(
            [
                Paragraph(
                    safe(
                        "Pour refaire cette analyse : mêmes entrées et paramètres (empreinte ci-dessus), même version de méthode de la plateforme "
                        "et, idéalement, mêmes versions des sources de données. Une nouvelle exécution peut être lancée et comparée à celle-ci depuis "
                        "la page Analyses. Les sources externes (UniProt, InterPro, AlphaFold DB, serveurs MMseqs2 et ESMFold) évoluent : "
                        "un écart entre deux exécutions peut venir d’une mise à jour de ces bases et non de la méthode. Les données complètes "
                        "sont exportables en JSON et les tableaux en CSV."
                    ),
                    styles["body"],
                )
            ]
        )
    )

    buffer = io.BytesIO()

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(15 * mm, 10 * mm, safe(f"MemProtScope · exécution {job['id']}").replace("&amp;", "&"))
        canvas.drawRightString(195 * mm, 10 * mm, f"page {doc.page}")
        canvas.restoreState()

    document = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=18 * mm, title="Rapport d'analyse MemProtScope", author="MemProtScope")
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
