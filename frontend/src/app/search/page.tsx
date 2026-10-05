"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  Download,
  Dna,
  ExternalLink,
  FileText,
  FlaskConical,
  Gauge,
  Info,
  Layers,
  Ruler,
  Scale,
  Search,
  Waves,
  Zap,
} from "lucide-react";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import SearchForm, { SEQUENCE_STORAGE_PREFIX } from "../../components/SearchForm";
import SequencePaste from "../../components/SequencePaste";
import SaveToProject from "../../components/SaveToProject";
import ConservationSummary from "../../components/evolution/ConservationSummary";
import EvolutionPanel from "../../components/evolution/EvolutionPanel";
import SequenceViewer from "../../components/sequence/SequenceViewer";
import HydropathyChart from "../../components/sequence/HydropathyChart";
import CompositionChart from "../../components/sequence/CompositionChart";
import {
  Alert,
  InfoBox,
  Panel,
  PanelLoading,
  SegmentedControl,
  StatCard,
} from "../../components/ui";
import { API_BASE } from "../../lib/api";
import { HERO_BG, HERO_GLOW, TONES, type Tone } from "../../lib/theme";
import { isValidAccession, normalizeAccession } from "../../lib/uniprot";
import {
  AA_CLASSES,
  MOTIF_PRESETS,
  TM_THRESHOLD,
  TM_WINDOW,
  computeComposition,
  computeProperties,
  downloadText,
  estimateTMSegments,
  findMotif,
  hydropathyProfile,
  positiveInsideRule,
  toFasta,
  type ParsedSequence,
  type TMSegment,
} from "../../lib/sequence";

type UniProtData = {
  accession: string;
  available?: boolean;
  protein_name: string;
  organism: string;
  function: string;
  sequence: string;
  length: number;
  gene_names?: string[];
  entry_type?: string;
};

type TMHMMData = {
  method?: string;
  deeptmhmm_status?: "pending" | "failed" | null;
  signal_peptide?: { start: number; end: number } | null;
  n_terminus?: "in" | "out" | null;
  is_membrane?: boolean | null;
  predicted_type?: string | null;
  tm_segments: TMSegment[];
};

type TMSource = "deeptmhmm" | "kd";

// DeepTMHMM passe par la file d’attente BioLib : la page réinterroge le
// serveur (qui attend lui-même ~25 s par requête) jusqu’au résultat.
const DEEPTMHMM_POLL_DELAY = 5000;
const DEEPTMHMM_MAX_POLLS = 40;

const WINDOW_SIZES = [5, 7, 9, 11, 13, 15, 17, 19, 21];

const fmt = (n: number, digits = 2) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function SearchPage() {
  // useSearchParams exige une frontière Suspense pour le rendu statique (next build)
  return (
    <Suspense fallback={null}>
      <SearchContent />
    </Suspense>
  );
}

function SearchContent() {
  const router = useRouter();
  const params = useSearchParams();
  const rawQuery = params.get("q") ?? "";
  const seqId = params.get("seq") ?? "";
  const mode: "accession" | "sequence" = seqId ? "sequence" : "accession";
  const query = normalizeAccession(rawQuery);
  const queryIsValid = mode === "accession" && !!query && isValidAccession(query);

  // --- Mode accession : UniProt + DeepTMHMM -------------------------------
  const [uniprot, setUniprot] = useState<UniProtData | null>(null);
  const [uniprotError, setUniprotError] = useState<string | null>(null);
  const [loadingUniprot, setLoadingUniprot] = useState(false);
  const [tmhmm, setTmhmm] = useState<TMHMMData | null>(null);
  const [tmhmmError, setTmhmmError] = useState<string | null>(null);
  const [loadingTmhmm, setLoadingTmhmm] = useState(false);
  const [deepPending, setDeepPending] = useState(false);

  // --- Mode séquence : séquence collée par l’utilisateur ------------------
  const [submitted, setSubmitted] = useState<ParsedSequence | null>(null);
  const [submittedError, setSubmittedError] = useState<string | null>(null);

  // --- Réglages d’affichage ------------------------------------------------
  const [tmSource, setTmSource] = useState<TMSource | null>(null);
  const [windowSize, setWindowSize] = useState(9);
  const [cursor, setCursor] = useState(1);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [motif, setMotif] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!queryIsValid) return;
    let cancelled = false;

    setUniprot(null);
    setUniprotError(null);
    setTmhmm(null);
    setTmhmmError(null);
    setDeepPending(false);
    setLoadingUniprot(true);
    setLoadingTmhmm(true);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const networkMessage = (e: Error) =>
      e instanceof TypeError ? "Impossible de joindre le serveur d’analyse." : e.message;

    // UniProt répond vite ; la prédiction membranaire peut être beaucoup plus longue.
    fetch(`${API_BASE}/api/uniprot/${query}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.available === false) {
          throw new Error(
            res.status === 404 || data.available === false
              ? `Aucune entrée UniProtKB trouvée pour ${query}.`
              : `Erreur du serveur (${res.status}).`
          );
        }
        if (!cancelled) setUniprot(data);
      })
      .catch((e: Error) => !cancelled && setUniprotError(networkMessage(e)))
      .finally(() => !cancelled && setLoadingUniprot(false));

    // Tant que DeepTMHMM est en file d’attente, le serveur renvoie les
    // annotations UniProt avec deeptmhmm_status = "pending".
    const loadMembrane = (attempt: number) => {
      fetch(`${API_BASE}/api/membrane/${query}`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok || data.error) {
            throw new Error(data.detail || data.error || `Erreur ${res.status}`);
          }
          if (cancelled) return;
          setTmhmm({ ...data, tm_segments: data.tm_segments ?? [] });
          setLoadingTmhmm(false);
          const pending = data.deeptmhmm_status === "pending" && attempt < DEEPTMHMM_MAX_POLLS;
          setDeepPending(pending);
          if (pending) timer = setTimeout(() => loadMembrane(attempt + 1), DEEPTMHMM_POLL_DELAY);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          // Une erreur pendant l’attente ne masque pas le résultat déjà affiché
          if (attempt === 0) setTmhmmError(networkMessage(e));
          setLoadingTmhmm(false);
          setDeepPending(false);
        });
    };
    loadMembrane(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, queryIsValid]);

  useEffect(() => {
    if (!seqId) return;
    setSubmitted(null);
    setSubmittedError(null);
    try {
      const stored = sessionStorage.getItem(SEQUENCE_STORAGE_PREFIX + seqId);
      if (stored) setSubmitted(JSON.parse(stored));
      else
        setSubmittedError(
          "Cette séquence n’est plus disponible dans la session du navigateur. Collez-la à nouveau pour relancer l’analyse."
        );
    } catch {
      setSubmittedError("Impossible de relire la séquence enregistrée dans ce navigateur.");
    }
  }, [seqId]);

  // Mode séquence : DeepTMHMM via le backend (facultatif, l’estimation
  // Kyte-Doolittle reste affichée en attendant ou en cas d’échec).
  useEffect(() => {
    if (mode !== "sequence" || !submitted) return;
    let cancelled = false;

    setTmhmm(null);
    setTmhmmError(null);
    setDeepPending(false);
    setLoadingTmhmm(true);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const loadPrediction = (attempt: number) => {
      fetch(`${API_BASE}/api/membrane/sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence: submitted.sequence, name: submitted.header || "query" }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || `Erreur ${res.status}`);
          if (cancelled) return;
          if (res.status === 202) {
            if (attempt >= DEEPTMHMM_MAX_POLLS)
              throw new Error("DeepTMHMM n’a pas répondu à temps (file d’attente BioLib).");
            setDeepPending(true);
            timer = setTimeout(() => loadPrediction(attempt + 1), DEEPTMHMM_POLL_DELAY);
            return;
          }
          setTmhmm({ ...data, tm_segments: data.tm_segments ?? [] });
          setDeepPending(false);
          setLoadingTmhmm(false);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setTmhmmError(
            e instanceof TypeError ? "Impossible de joindre le serveur d’analyse." : e.message
          );
          setDeepPending(false);
          setLoadingTmhmm(false);
        });
    };
    loadPrediction(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, submitted]);

  const sequence = (mode === "sequence" ? submitted?.sequence : uniprot?.sequence) ?? "";
  const warnings = mode === "sequence" ? submitted?.warnings ?? [] : [];
  const entryName = mode === "sequence" ? submitted?.header || "Séquence soumise" : uniprot?.accession ?? "";
  const fileBase = (mode === "sequence" ? "sequence_" + seqId : uniprot?.accession ?? "sequence").replace(
    /[^\w.-]/g,
    "_"
  );

  useEffect(() => {
    setCursor(1);
    setSelectedSegment(null);
    setTmSource(null);
    setMotif("");
  }, [sequence]);

  // --- Analyses ------------------------------------------------------------
  const properties = useMemo(() => (sequence ? computeProperties(sequence) : null), [sequence]);
  const composition = useMemo(() => computeComposition(sequence), [sequence]);
  const profile = useMemo(() => hydropathyProfile(sequence, windowSize), [sequence, windowSize]);
  const kdSegments = useMemo(() => estimateTMSegments(sequence), [sequence]);
  const deepSegments = useMemo(() => tmhmm?.tm_segments ?? [], [tmhmm]);

  // Segments fournis par le serveur (annotation UniProt ou DeepTMHMM).
  // method « none » : entrée non révisée sans annotation, rien d’exploitable.
  const hasDeep = !!tmhmm && tmhmm.method !== "none";
  const predictorLabel = tmhmm?.method === "UniProt annotation" ? "Annotation UniProt" : "DeepTMHMM";
  const source: TMSource = tmSource === "kd" || !hasDeep ? "kd" : "deeptmhmm";
  const segments = source === "deeptmhmm" ? deepSegments : kdSegments;

  const topology = useMemo(() => positiveInsideRule(sequence, segments), [sequence, segments]);
  const motifResult = useMemo(() => findMotif(sequence, motif), [sequence, motif]);

  const tmCoverage = useMemo(() => {
    if (!sequence.length || !segments.length) return 0;
    const total = segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start + 1), 0);
    return Math.round((total / sequence.length) * 100);
  }, [sequence, segments]);

  const classShares = useMemo(
    () =>
      AA_CLASSES.map((cls) => ({
        label: cls.label,
        percent: composition
          .filter((c) => cls.residues.includes(c.aa))
          .reduce((sum, c) => sum + c.percent, 0),
      })),
    [composition]
  );

  const membraneStatus: "yes" | "no" | "unknown" = hasDeep
    ? tmhmm!.is_membrane == null
      ? "unknown"
      : tmhmm!.is_membrane
      ? "yes"
      : "no"
    : kdSegments.length
    ? "yes"
    : "no";

  const interpretation = useMemo(() => {
    if (hasDeep) {
      if (membraneStatus === "yes" && deepSegments.length >= 6)
        return "Profil compatible avec une protéine membranaire multi-pass. Les segments TM multiples suggèrent un rôle possible dans le transport, la signalisation ou l’ancrage membranaire.";
      if (membraneStatus === "yes")
        return "Profil compatible avec une protéine membranaire. La présence d’au moins un segment transmembranaire soutient une localisation ou un ancrage membranaire.";
      if (membraneStatus === "no")
        return "Aucun segment transmembranaire clair n’a été détecté. Le profil est plus compatible avec une protéine soluble.";
      return "Le statut membranaire n’a pas été renvoyé par le service de prédiction.";
    }
    if (kdSegments.length)
      return `${kdSegments.length} région(s) hydrophobe(s) compatible(s) avec des hélices transmembranaires (Kyte-Doolittle, fenêtre ${TM_WINDOW}, seuil ${fmt(TM_THRESHOLD, 1)}). Cette estimation est indicative : confirmez-la avec un prédicteur dédié.`;
    return "Aucune région suffisamment hydrophobe pour former une hélice transmembranaire n’a été détectée (estimation Kyte-Doolittle).";
  }, [hasDeep, membraneStatus, deepSegments, kdSegments]);

  // --- Actions -------------------------------------------------------------
  const scrollToResidue = (position: number, delay = 50) => {
    setTimeout(() => {
      document.getElementById(`aa-${position}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }, delay);
  };

  const locate = (position: number) => {
    setCursor(position);
    scrollToResidue(position, 80);
  };

  const selectSegment = (index: number, seg: TMSegment) => {
    setSelectedSegment(index);
    locate(seg.start);
  };

  const copySequence = async () => {
    if (!sequence) return;
    await navigator.clipboard.writeText(sequence);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const exports = properties
    ? [
        {
          label: "Séquence (FASTA)",
          run: () =>
            downloadText(`${fileBase}.fasta`, toFasta(mode === "sequence" ? entryName : uniprot?.accession ?? "sequence", sequence)),
        },
        {
          label: "Propriétés (CSV)",
          run: () =>
            downloadText(
              `${fileBase}_proprietes.csv`,
              toCSV([
                ["propriete", "valeur"],
                ["longueur_aa", properties.length],
                ["masse_moleculaire_da", properties.molecularWeight.toFixed(2)],
                ["point_isoelectrique", properties.isoelectricPoint.toFixed(2)],
                ["charge_ph7", properties.chargeAtPH7.toFixed(2)],
                ["residus_positifs_KR", properties.positive],
                ["residus_negatifs_DE", properties.negative],
                ["coef_extinction_reduit", properties.extinctionReduced],
                ["coef_extinction_cystines", properties.extinctionCystines],
                ["abs_0.1pct", properties.absorbance01.toFixed(3)],
                ["indice_aliphatique", properties.aliphaticIndex.toFixed(2)],
                ["gravy", properties.gravy.toFixed(3)],
                ...composition.map((c) => [`composition_${c.aa}_pct`, c.percent.toFixed(2)]),
              ]),
              "text/csv"
            ),
        },
        {
          label: "Segments TM (CSV)",
          run: () =>
            downloadText(
              `${fileBase}_segments_tm_${source}.csv`,
              toCSV([
                ["segment", "debut", "fin", "longueur", "source"],
                ...segments.map((s, i) => [`TM${i + 1}`, s.start, s.end, s.end - s.start + 1, source]),
              ]),
              "text/csv"
            ),
        },
        {
          label: "Profil d’hydropathie (CSV)",
          run: () =>
            downloadText(
              `${fileBase}_hydropathie_f${windowSize}.csv`,
              toCSV([
                ["position", "residu", "score_kyte_doolittle"],
                ...profile.map((p) => [p.position, sequence[p.position - 1], p.score.toFixed(3)]),
              ]),
              "text/csv"
            ),
        },
        ...(motifResult.hits.length
          ? [
              {
                label: "Motifs trouvés (CSV)",
                run: () =>
                  downloadText(
                    `${fileBase}_motifs.csv`,
                    toCSV([
                      ["motif", "debut", "fin", "sequence"],
                      ...motifResult.hits.map((h) => [motif, h.start, h.end, h.match]),
                    ]),
                    "text/csv"
                  ),
              },
            ]
          : []),
      ]
    : [];

  const breadcrumb =
    mode === "sequence" ? "Séquence soumise" : queryIsValid ? query : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#eef2f6] text-slate-900">
      <SiteHeader active="search" />

      <section className={HERO_BG}>
        <div aria-hidden className={HERO_GLOW} />
        <div className="relative grid w-full gap-5 px-4 py-5 lg:grid-cols-[1fr_1.1fr] lg:items-end lg:px-6">
          <div>
            <nav className="flex items-center gap-1 text-[13px] text-blue-200">
              <Link href="/" className="hover:text-white">
                Accueil
              </Link>
              <ChevronRight size={12} />
              <span className="text-white">Recherche</span>
              {breadcrumb && (
                <>
                  <ChevronRight size={12} />
                  <span className="font-mono text-cyan-200">{breadcrumb}</span>
                </>
              )}
            </nav>
            <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight text-white">
              Analyse de séquence
            </h1>
            <p className="mt-1 text-[15px] text-blue-100">
              Annotation UniProtKB, topologie transmembranaire, hydropathie, propriétés
              physico-chimiques, composition et recherche de motifs — pour une accession ou
              n’importe quelle séquence protéique.
            </p>
          </div>
          <SearchForm
            key={`${mode}-${rawQuery}-${seqId}-${submitted ? 1 : 0}`}
            initialMode={mode}
            initialValue={
              mode === "sequence" && submitted ? toFasta(entryName, submitted.sequence) : rawQuery
            }
            showExamples={!rawQuery && !seqId}
          />
        </div>
      </section>

      <main className="w-full flex-1 space-y-4 px-4 py-4 lg:px-6">
        {!rawQuery && !seqId && (
          <>
            <SequencePaste />
            <EmptyState />
          </>
        )}

        {mode === "accession" && rawQuery && !queryIsValid && (
          <Alert tone="rose" title="Accession invalide">
            « {rawQuery} » n’est pas une accession UniProtKB valide. Exemple : P07550. Pour
            analyser une séquence, utilisez l’onglet « Séquence / FASTA ».
          </Alert>
        )}

        {queryIsValid && loadingUniprot && <LoadingSkeleton />}

        {queryIsValid && uniprotError && (
          <Alert tone="rose" title="Entrée introuvable">
            {uniprotError}
          </Alert>
        )}

        {submittedError && (
          <Alert tone="amber" title="Séquence indisponible">
            {submittedError}
          </Alert>
        )}

        {sequence && properties && (
          <>
            <EntryHeader
              mode={mode}
              uniprot={uniprot}
              name={entryName}
              length={sequence.length}
              sequence={sequence}
              onContinue={() => uniprot && router.push(`/structures/${uniprot.accession}`)}
            />

            {warnings.length > 0 && (
              <Alert tone="amber" title="Remarques sur la séquence">
                <ul className="list-inside list-disc">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                tone="violet"
                icon={<Ruler size={16} />}
                label="Longueur"
                value={`${sequence.length.toLocaleString("fr-FR")} aa`}
                hint={`Masse : ${fmt(properties.molecularWeight / 1000)} kDa`}
              />
              <StatCard
                tone="blue"
                icon={<Zap size={16} />}
                label="Point isoélectrique"
                value={fmt(properties.isoelectricPoint)}
                hint={`Charge nette à pH 7 : ${properties.chargeAtPH7 > 0 ? "+" : ""}${fmt(properties.chargeAtPH7, 1)}`}
              />
              <StatCard
                tone="amber"
                icon={<Waves size={16} />}
                label="GRAVY"
                value={fmt(properties.gravy, 3)}
                hint={properties.gravy > 0 ? "Globalement hydrophobe" : "Globalement hydrophile"}
              />
              <StatCard
                tone={membraneStatus === "yes" ? "emerald" : membraneStatus === "no" ? "rose" : "slate"}
                icon={<Layers size={16} />}
                label="Segments TM"
                value={`${segments.length}`}
                hint={`${source === "deeptmhmm" ? predictorLabel : "Estimation Kyte-Doolittle"} · couverture ${tmCoverage} %`}
              />
            </section>

            {loadingTmhmm && (
              <Alert tone="blue" title="Récupération des segments transmembranaires" loading>
                La prédiction DeepTMHMM peut prendre de quelques secondes à plusieurs minutes.
                En attendant, la topologie affichée est l’estimation Kyte-Doolittle.
              </Alert>
            )}
            {deepPending && !loadingTmhmm && (
              <Alert tone="blue" title="Prédiction DeepTMHMM en cours" loading>
                Le calcul attend dans la file de BioLib. Les segments annotés par UniProt sont
                affichés en attendant ; la page se mettra à jour automatiquement.
              </Alert>
            )}
            {tmhmm?.deeptmhmm_status === "failed" && (
              <Alert tone="slate" title="DeepTMHMM indisponible">
                La prédiction a échoué ; les segments affichés proviennent des annotations UniProt.
              </Alert>
            )}
            {tmhmmError && (
              <Alert tone="amber" title="Segments transmembranaires indisponibles">
                {tmhmmError} La topologie affichée est l’estimation Kyte-Doolittle.
              </Alert>
            )}
            {mode === "accession" && tmhmm?.method === "none" && (
              <Alert tone="slate" title="Aucune annotation transmembranaire">
                Cette entrée UniProt n’est pas révisée (TrEMBL) et ne contient pas de région
                transmembranaire annotée. La topologie affichée est l’estimation Kyte-Doolittle.
              </Alert>
            )}
            <Alert
              tone={membraneStatus === "yes" ? "emerald" : membraneStatus === "no" ? "amber" : "slate"}
              title={hasDeep ? `Interprétation biologique (${predictorLabel})` : "Interprétation (estimation)"}
            >
              {interpretation}
            </Alert>

            <div className="grid gap-4 lg:grid-cols-2">
              {mode === "accession" && uniprot ? (
                <Panel tone="blue" icon={<Database size={16} />} label="UniProtKB" title="Informations biologiques">
                  <dl className="grid gap-2 text-[14px] sm:grid-cols-2">
                    <InfoBox label="Accession" value={uniprot.accession} mono />
                    <InfoBox label="Type d’entrée" value={uniprot.entry_type || "—"} />
                    <InfoBox label="Nom" value={uniprot.protein_name || "—"} wide />
                    <InfoBox label="Organisme" value={uniprot.organism || "—"} italic />
                    <InfoBox label="Gènes" value={uniprot.gene_names?.join(", ") || "—"} />
                  </dl>
                  <h3 className="mb-1 mt-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Fonction
                  </h3>
                  <p className="max-h-[160px] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[14px] leading-5 text-slate-700">
                    {uniprot.function || "Aucune fonction annotée."}
                  </p>
                </Panel>
              ) : (
                <Panel tone="blue" icon={<FileText size={16} />} label="Séquence utilisateur" title="Séquence soumise">
                  <dl className="grid gap-2 text-[14px] sm:grid-cols-2">
                    <InfoBox label="En-tête FASTA" value={submitted?.header || "—"} wide />
                    <InfoBox label="Longueur" value={`${sequence.length.toLocaleString("fr-FR")} aa`} />
                    <InfoBox label="Masse" value={`${fmt(properties.molecularWeight / 1000)} kDa`} />
                  </dl>
                  <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-[14px] leading-5 text-slate-600">
                    Sans accession UniProt, l’annotation biologique et l’analyse structurale
                    (PDB, AlphaFold) ne sont pas disponibles. La topologie est prédite par
                    DeepTMHMM ; les autres analyses sont calculées à partir de la séquence.
                  </p>
                </Panel>
              )}

              <Panel tone="violet" icon={<FlaskConical size={16} />} label="Physico-chimie" title="Propriétés de la protéine">
                <table className="w-full text-[14px]">
                  <tbody className="divide-y divide-slate-100">
                    <PropRow label="Masse moléculaire" value={`${fmt(properties.molecularWeight)} Da`} note={properties.unknownMass ? `${properties.unknownMass} résidu(s) inconnu(s) non comptés` : undefined} />
                    <PropRow label="Point isoélectrique (pI)" value={fmt(properties.isoelectricPoint)} />
                    <PropRow label="Charge nette à pH 7" value={`${properties.chargeAtPH7 > 0 ? "+" : ""}${fmt(properties.chargeAtPH7)}`} />
                    <PropRow label="Résidus chargés" value={`${properties.positive} positifs (K, R) · ${properties.negative} négatifs (D, E)`} />
                    <PropRow
                      label="Coefficient d’extinction (280 nm)"
                      value={`${properties.extinctionCystines.toLocaleString("fr-FR")} M⁻¹·cm⁻¹`}
                      note={`${properties.extinctionReduced.toLocaleString("fr-FR")} si toutes les Cys sont réduites`}
                    />
                    <PropRow label="Absorbance 0,1 % (1 g/L)" value={fmt(properties.absorbance01, 3)} note={properties.extinctionReduced === 0 ? "Aucun Trp ni Tyr : mesure à 280 nm peu fiable" : undefined} />
                    <PropRow label="Indice aliphatique" value={fmt(properties.aliphaticIndex)} note="Plus il est élevé, plus la protéine est thermostable" />
                    <PropRow label="GRAVY" value={fmt(properties.gravy, 3)} note="Moyenne Kyte-Doolittle ; > 0 : hydrophobe" />
                  </tbody>
                </table>
                <p className="mt-2 text-[12px] text-slate-400">
                  Masses moyennes ; pI calculé avec les pKa EMBOSS ; coefficient d’extinction
                  selon Pace et al. (1995).
                </p>
              </Panel>
            </div>

            <Panel
              id="topologie"
              tone="cyan"
              icon={<Activity size={16} />}
              label="Membrane"
              title="Topologie transmembranaire"
              actions={
                <SegmentedControl<TMSource>
                  label="Source des segments"
                  value={source}
                  onChange={(v) => {
                    setTmSource(v);
                    setSelectedSegment(null);
                  }}
                  options={[
                    {
                      value: "deeptmhmm",
                      label: predictorLabel,
                      disabled: !hasDeep,
                      title: loadingTmhmm ? "Prédiction en cours" : !hasDeep ? "Indisponible pour cette requête" : undefined,
                    },
                    { value: "kd", label: "Estimation Kyte-Doolittle" },
                  ]}
                />
              }
            >
              <div className="space-y-2">
                {(
                  <TopologyTrack
                    label={tmhmm?.method === "UniProt annotation" ? "UniProt" : "DeepTMHMM"}
                    signalPeptide={tmhmm?.signal_peptide ?? null}
                    length={sequence.length}
                    segments={deepSegments}
                    active={source === "deeptmhmm"}
                    selected={source === "deeptmhmm" ? selectedSegment : null}
                    cursor={cursor}
                    loading={loadingTmhmm}
                    unavailable={!!tmhmmError || tmhmm?.method === "none"}
                    onSelect={(i, s) => {
                      setTmSource("deeptmhmm");
                      selectSegment(i, s);
                    }}
                  />
                )}
                <TopologyTrack
                  label="Kyte-Doolittle"
                  length={sequence.length}
                  segments={kdSegments}
                  active={source === "kd"}
                  selected={source === "kd" ? selectedSegment : null}
                  cursor={cursor}
                  onSelect={(i, s) => {
                    setTmSource("kd");
                    selectSegment(i, s);
                  }}
                />
                <div className="flex justify-between pl-[110px] font-mono text-[12px] text-slate-400">
                  <span>1</span>
                  <span>{sequence.length}</span>
                </div>
              </div>

              <div className="mt-3 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="max-h-[240px] overflow-auto rounded-md border border-slate-200">
                  <table className="w-full text-[14px]">
                    <thead className="sticky top-0 bg-slate-50 text-[13px] text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Segment</th>
                        <th className="px-3 py-2 text-right font-semibold">Début</th>
                        <th className="px-3 py-2 text-right font-semibold">Fin</th>
                        <th className="px-3 py-2 text-right font-semibold">Longueur</th>
                        <th className="px-3 py-2 text-right font-semibold">KD moyen</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {segments.length > 0 ? (
                        segments.map((s, i) => (
                          <tr key={i} className={`border-t border-slate-100 ${selectedSegment === i ? "bg-blue-50" : ""}`}>
                            <td className="px-3 py-1.5 font-semibold text-blue-700">TM{i + 1}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{s.start}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{s.end}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{s.end - s.start + 1}</td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {fmt(computeProperties(sequence.slice(s.start - 1, s.end)).gravy)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <button
                                onClick={() => selectSegment(i, s)}
                                className="rounded border border-blue-200 px-2 py-0.5 text-[13px] text-blue-700 hover:bg-blue-50"
                              >
                                Localiser
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-3 text-center text-slate-500">
                            Aucun segment transmembranaire.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[14px]">
                  {tmhmm?.method === "DeepTMHMM" && (tmhmm.n_terminus || tmhmm.signal_peptide) && (
                    <div className="mb-3 border-b border-slate-200 pb-3">
                      <h3 className="text-[14px] font-semibold text-slate-900">Topologie DeepTMHMM</h3>
                      {tmhmm.n_terminus && (
                        <p className="mt-1 text-[15px] font-semibold text-slate-900">
                          Extrémité N-terminale{" "}
                          {tmhmm.n_terminus === "in" ? "cytoplasmique" : "extracellulaire / luminale"}
                        </p>
                      )}
                      {tmhmm.signal_peptide && (
                        <p className="mt-1 text-slate-600">
                          Peptide signal prédit :{" "}
                          <span className="font-mono font-semibold text-amber-700">
                            {tmhmm.signal_peptide.start}–{tmhmm.signal_peptide.end}
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                  <h3 className="text-[14px] font-semibold text-slate-900">
                    Orientation probable (règle « positive-inside »)
                  </h3>
                  {topology ? (
                    <>
                      <p className="mt-2 text-[15px] font-semibold text-slate-900">
                        {topology.nTerminus === "in"
                          ? "Extrémité N-terminale cytoplasmique"
                          : topology.nTerminus === "out"
                          ? "Extrémité N-terminale extracellulaire / luminale"
                          : "Orientation indéterminée"}
                      </p>
                      <dl className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded bg-white p-2 ring-1 ring-slate-200">
                          <dt className="text-[12px] uppercase tracking-[0.08em] text-slate-500">K + R côté N-ter</dt>
                          <dd className="font-mono text-[17px] font-semibold">{topology.krNSide}</dd>
                        </div>
                        <div className="rounded bg-white p-2 ring-1 ring-slate-200">
                          <dt className="text-[12px] uppercase tracking-[0.08em] text-slate-500">K + R côté opposé</dt>
                          <dd className="font-mono text-[17px] font-semibold">{topology.krOtherSide}</dd>
                        </div>
                      </dl>
                      <p className="mt-2 text-[13px] leading-4 text-slate-500">
                        Les boucles riches en lysines et arginines sont généralement
                        cytoplasmiques (von Heijne, 1992). Résidus comptés à moins de 15
                        positions des segments TM.
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-slate-500">Nécessite au moins un segment transmembranaire.</p>
                  )}
                </div>
              </div>
            </Panel>

            {mode === "accession" && uniprot && <ConservationSummary accession={uniprot.accession} />}
            {mode === "sequence" && sequence.length >= 20 && <EvolutionPanel sequence={sequence} name={entryName} />}

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                tone="amber"
                icon={<Waves size={16} />}
                label="Kyte-Doolittle"
                title="Profil d’hydropathie"
                actions={
                  <label className="flex items-center gap-2 text-[13px] text-slate-600">
                    Fenêtre
                    <select
                      value={windowSize}
                      onChange={(e) => setWindowSize(Number(e.target.value))}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[14px] text-slate-900"
                    >
                      {WINDOW_SIZES.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </label>
                }
              >
                <HydropathyChart profile={profile} sequence={sequence} segments={segments} windowSize={windowSize} />
                <p className="mt-2 text-[13px] text-slate-500">
                  Bandes bleues : segments TM ({source === "deeptmhmm" ? predictorLabel : "estimation"}).
                  Une fenêtre de 19 est adaptée à la détection des hélices transmembranaires,
                  une fenêtre de 7 à 9 aux régions exposées en surface.
                </p>
              </Panel>

              <Panel tone="emerald" icon={<BarChart3 size={16} />} label="Composition" title="Composition en acides aminés">
                <CompositionChart composition={composition} />
                <div className="mt-3 grid grid-cols-5 gap-1.5">
                  {classShares.map((c) => (
                    <div key={c.label} className="rounded bg-slate-50 px-2 py-1.5 text-center ring-1 ring-slate-200">
                      <p className="text-[12px] text-slate-500">{c.label}</p>
                      <p className="font-mono text-[15px] font-semibold text-slate-900">
                        {fmt(c.percent, 1)} %
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <Panel
              id="sequence"
              tone="rose"
              icon={<Dna size={16} />}
              label="Séquence"
              title="Séquence et motifs"
              actions={
                <button
                  onClick={copySequence}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  {copied ? "Copiée" : "Copier la séquence"}
                </button>
              }
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="min-w-0">
                  <div className="mb-3 flex items-center gap-3">
                    <label htmlFor="cursor" className="shrink-0 text-[13px] text-slate-600">
                      Position
                    </label>
                    <input
                      id="cursor"
                      type="range"
                      min={1}
                      max={sequence.length}
                      value={cursor}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setCursor(value);
                        setSelectedSegment(null);
                        scrollToResidue(value);
                      }}
                      className="w-full accent-rose-500"
                    />
                    <span className="shrink-0 rounded bg-rose-500 px-2 py-0.5 font-mono text-[13px] font-semibold text-white">
                      {sequence[cursor - 1]}
                      {cursor}
                    </span>
                  </div>

                  <SequenceViewer
                    sequence={sequence}
                    segments={segments}
                    selectedSegment={selectedSegment}
                    motifHits={motifResult.hits}
                    cursor={cursor}
                    onResidueClick={(p) => {
                      setCursor(p);
                      setSelectedSegment(null);
                    }}
                  />

                  <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                    <Legend label="Hydrophobe" className="bg-slate-200 text-slate-900" />
                    <Legend label="Polaire" className="bg-emerald-100 text-emerald-900" />
                    <Legend label="Amide" className="bg-purple-100 text-purple-900" />
                    <Legend label="Basique" className="bg-blue-100 text-blue-900" />
                    <Legend label="Acide" className="bg-red-100 text-red-900" />
                    <Legend label="Segment TM" className="bg-white text-blue-700 underline decoration-blue-600 decoration-2 underline-offset-2 ring-1 ring-slate-200" />
                    <Legend label="Motif" className="bg-amber-300 font-semibold text-amber-950" />
                    <Legend label="Position" className="bg-rose-500 text-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="motif" className="block text-[14px] font-semibold text-slate-900">
                    Recherche de motif
                  </label>
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="motif"
                      value={motif}
                      onChange={(e) => setMotif(e.target.value)}
                      placeholder="ex. N-{P}-[ST]-{P} ou RGD"
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2 font-mono text-[14px] outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                    />
                  </div>
                  <p className="text-[12px] leading-4 text-slate-500">
                    Syntaxe PROSITE (x = tout résidu, [ST] = S ou T, {"{P}"} = sauf P, x(2) =
                    répétition) ou expression régulière.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {MOTIF_PRESETS.map((p) => (
                      <button
                        key={p.ref}
                        type="button"
                        onClick={() => setMotif(p.pattern)}
                        title={`${p.pattern} (PROSITE ${p.ref})`}
                        className={`rounded border px-1.5 py-0.5 text-[12px] transition ${
                          motif === p.pattern
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {motif && (
                    <div className="rounded-md border border-slate-200">
                      <p className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-700">
                        {motifResult.error ? (
                          <span className="text-rose-600">{motifResult.error}</span>
                        ) : (
                          <>
                            <span className="font-semibold">{motifResult.hits.length}</span>{" "}
                            occurrence{motifResult.hits.length > 1 ? "s" : ""}
                            {motifResult.truncated && " (liste tronquée)"}
                          </>
                        )}
                      </p>
                      {motifResult.hits.length > 0 && (
                        <ul className="max-h-[220px] divide-y divide-slate-100 overflow-auto text-[13px]">
                          {motifResult.hits.slice(0, 200).map((h) => (
                            <li key={h.start} className="flex items-center justify-between gap-2 px-3 py-1">
                              <span className="font-mono">
                                <span className="text-slate-500">{h.start}–{h.end}</span>{" "}
                                <span className="font-semibold text-slate-900">{h.match}</span>
                              </span>
                              <button
                                onClick={() => locate(h.start)}
                                className="rounded border border-rose-200 px-1.5 py-0.5 text-[12px] text-rose-700 hover:bg-rose-50"
                              >
                                Localiser
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <Panel tone="slate" icon={<Download size={16} />} label="Export" title="Télécharger les résultats">
                <div className="flex flex-wrap gap-2">
                  {exports.map((e) => (
                    <button
                      key={e.label}
                      onClick={e.run}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Download size={13} />
                      {e.label}
                    </button>
                  ))}
                </div>
              </Panel>

              {mode === "accession" && uniprot ? (
                <section className="flex flex-col items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-violet-600 p-2 text-white">
                      <Info size={16} />
                    </div>
                    <div>
                      <p className="text-[16px] font-semibold text-slate-900">Étape suivante : analyse structurale</p>
                      <p className="text-[14px] text-slate-600">
                        {membraneStatus === "no"
                          ? "La protéine semble non membranaire ; l’analyse structurale reste disponible."
                          : "Structures PDB, modèle AlphaFold, qualité et orientation membranaire."}
                      </p>
                    </div>
                  </div>
                  <ContinueButton onClick={() => router.push(`/structures/${uniprot.accession}`)} />
                </section>
              ) : (
                <section className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
                  <div className="rounded-md bg-slate-500 p-2 text-white">
                    <Info size={16} />
                  </div>
                  <p className="text-[14px] text-slate-600">
                    L’analyse structurale nécessite une accession UniProt. Si votre séquence
                    correspond à une protéine connue, recherchez-la par son accession pour accéder
                    à l’annotation UniProt et aux structures 3D.
                  </p>
                </section>
              )}
            </div>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function EntryHeader({
  mode,
  uniprot,
  name,
  length,
  sequence,
  onContinue,
}: {
  mode: "accession" | "sequence";
  uniprot: UniProtData | null;
  name: string;
  length: number;
  sequence?: string;
  onContinue: () => void;
}) {
  return (
    <section className="relative rounded-lg border border-slate-200 bg-white">
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-gradient-to-b from-blue-600 to-cyan-500" />
      <div className="flex flex-col gap-3 p-4 pl-5 lg:flex-row lg:items-center lg:justify-between">
        {mode === "accession" && uniprot ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-blue-600 px-2 py-0.5 font-mono text-[14px] font-semibold text-white">
                {uniprot.accession}
              </span>
              {uniprot.entry_type && (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[13px] text-slate-600">{uniprot.entry_type}</span>
              )}
              {uniprot.gene_names?.[0] && (
                <span className="rounded bg-violet-50 px-2 py-0.5 font-mono text-[13px] font-semibold text-violet-700">
                  {uniprot.gene_names[0]}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-[22px] font-bold leading-tight text-slate-900">
              {uniprot.protein_name || "Protéine sans nom recommandé"}
            </h2>
            <p className="text-[15px] italic text-slate-500">{uniprot.organism}</p>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-700 px-2 py-0.5 text-[13px] font-semibold text-white">
                Séquence utilisateur
              </span>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[13px] text-slate-600">
                {length.toLocaleString("fr-FR")} aa
              </span>
            </div>
            <h2 className="mt-1.5 truncate text-[22px] font-bold leading-tight text-slate-900" title={name}>
              {name}
            </h2>
            <p className="text-[15px] text-slate-500">Analyse calculée à partir de la séquence fournie</p>
          </div>
        )}

        {mode === "sequence" && sequence && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SaveToProject
              kind="sequence"
              title={name}
              payload={{ sequence, header: name, length }}
            />
          </div>
        )}

        {mode === "accession" && uniprot && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SaveToProject
              kind="accession"
              title={uniprot.protein_name || uniprot.accession}
              payload={{
                accession: uniprot.accession,
                protein_name: uniprot.protein_name,
                organism: uniprot.organism,
                length: uniprot.length,
              }}
            />
            <a
              href={`https://www.uniprot.org/uniprotkb/${uniprot.accession}/entry`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-[14px] font-medium text-slate-700 hover:bg-slate-50"
            >
              UniProt
              <ExternalLink size={13} />
            </a>
            <ContinueButton onClick={onContinue} />
          </div>
        )}
      </div>
    </section>
  );
}

function TopologyTrack({
  label,
  length,
  segments,
  active,
  selected,
  cursor,
  loading = false,
  unavailable = false,
  signalPeptide = null,
  onSelect,
}: {
  label: string;
  length: number;
  segments: TMSegment[];
  active: boolean;
  selected: number | null;
  cursor: number;
  loading?: boolean;
  unavailable?: boolean;
  signalPeptide?: { start: number; end: number } | null;
  onSelect: (index: number, seg: TMSegment) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`w-[100px] shrink-0 text-right text-[13px] font-semibold ${
          active ? "text-slate-900" : "text-slate-400"
        }`}
      >
        {label}
      </span>
      <div
        className={`relative h-5 flex-1 overflow-hidden rounded ${
          active ? "bg-slate-200" : "bg-slate-100"
        }`}
      >
        {loading ? (
          <div className="h-full w-full animate-pulse bg-slate-200" />
        ) : unavailable ? (
          <p className="px-2 text-[12px] leading-5 text-slate-400">indisponible</p>
        ) : (
          <>
          {signalPeptide && (
            <span
              className="absolute top-0 h-full bg-amber-400"
              style={{
                left: `${((signalPeptide.start - 1) / length) * 100}%`,
                width: `${((signalPeptide.end - signalPeptide.start + 1) / length) * 100}%`,
              }}
              title={`Peptide signal : ${signalPeptide.start}–${signalPeptide.end}`}
            />
          )}
          {segments.map((s, i) => (
            <button
              key={i}
              onClick={() => onSelect(i, s)}
              className={`absolute top-0 h-full transition ${
                selected === i
                  ? "bg-blue-800"
                  : active
                  ? "bg-blue-500 hover:bg-blue-700"
                  : "bg-blue-300 hover:bg-blue-500"
              }`}
              style={{
                left: `${((s.start - 1) / length) * 100}%`,
                width: `${Math.max(((s.end - s.start + 1) / length) * 100, 0.3)}%`,
              }}
              title={`TM${i + 1} : ${s.start}–${s.end}`}
              aria-label={`${label} : segment TM${i + 1}, positions ${s.start} à ${s.end}`}
            />
          ))}
          </>
        )}
        <div
          className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-rose-500"
          style={{ left: `${((cursor - 1) / length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function PropRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <tr>
      <td className="py-1.5 pr-3 align-top text-slate-600">{label}</td>
      <td className="py-1.5 text-right align-top">
        <span className="font-mono font-semibold text-slate-900">{value}</span>
        {note && <p className="text-[12px] text-slate-400">{note}</p>}
      </td>
    </tr>
  );
}

function ContinueButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-2 rounded-md bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2 text-[15px] font-semibold text-white shadow-sm transition hover:from-blue-500 hover:to-cyan-500"
    >
      Analyse structurale
      <ArrowRight size={15} />
    </button>
  );
}

function EmptyState() {
  const features: { tone: Tone; icon: React.ReactNode; title: string; text: string }[] = [
    { tone: "blue", icon: <Database size={15} />, title: "Annotation UniProtKB", text: "Nom, organisme, gènes et fonction (avec une accession)." },
    { tone: "cyan", icon: <Activity size={15} />, title: "Topologie membranaire", text: "Segments TM annotés (UniProt), DeepTMHMM ou estimation Kyte-Doolittle, orientation « positive-inside »." },
    { tone: "amber", icon: <Waves size={15} />, title: "Profil d’hydropathie", text: "Courbe interactive, fenêtre réglable de 5 à 21 résidus." },
    { tone: "violet", icon: <Scale size={15} />, title: "Propriétés physico-chimiques", text: "Masse, pI, charge, coefficient d’extinction, indice aliphatique, GRAVY." },
    { tone: "emerald", icon: <BarChart3 size={15} />, title: "Composition", text: "Fréquence des 20 acides aminés, regroupés par classe." },
    { tone: "rose", icon: <Gauge size={15} />, title: "Motifs et export", text: "Motifs PROSITE (glycosylation, phosphorylation…) et export CSV / FASTA." },
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-l-4 border-cyan-500 px-4 py-3">
        <h2 className="text-[18px] font-bold text-slate-900">
          Saisissez une accession UniProtKB ou collez une séquence
        </h2>
        <p className="text-[14px] text-slate-500">
          Toute séquence protéique est acceptée (brute ou FASTA, jusqu’à 100 000 résidus).
          Analyses disponibles :
        </p>
      </div>
      <ul className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <li key={f.title} className="relative flex gap-3 bg-white p-4">
            <span className={`absolute inset-x-0 top-0 h-1 ${TONES[f.tone].bar}`} />
            <span className={`h-fit rounded-md p-2 ${TONES[f.tone].badge}`}>{f.icon}</span>
            <div>
              <h3 className="text-[16px] font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-0.5 text-[14px] text-slate-600">{f.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Chargement">
      <div className="h-[92px] animate-pulse rounded-lg border border-slate-200 bg-white" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[84px] animate-pulse rounded-lg border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[280px] animate-pulse rounded-lg border border-slate-200 bg-white" />
        <div className="h-[280px] animate-pulse rounded-lg border border-slate-200 bg-white" />
      </div>
    </div>
  );
}

function Legend({ label, className }: { label: string; className: string }) {
  return <span className={`rounded px-2 py-0.5 font-medium ${className}`}>{label}</span>;
}

function toCSV(rows: (string | number)[][]) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
}
