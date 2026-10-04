"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  ArrowRight,
  ArrowLeft,
  Database,
  Activity,
  Dna,
  ShieldCheck,
  Layers3,
  Copy,
  CheckCircle2,
  Info,
  Waves,
} from "lucide-react";

type UniProtData = {
  accession: string;
  protein_name: string;
  organism: string;
  function: string;
  sequence: string;
  length: number;
  gene_names?: string[];
  entry_type?: string;
};

type TMSegment = {
  start: number;
  end: number;
  label?: string;
};

type TMHMMData = {
  is_membrane: boolean;
  predicted_type: string | null;
  tm_segments: TMSegment[];
  raw_output?: string;
};

export default function SearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get("q");

  const [input, setInput] = useState(query || "");
  const [uniprot, setUniprot] = useState<UniProtData | null>(null);
  const [tmhmm, setTmhmm] = useState<TMHMMData | null>(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(1);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setInput(query || "");
  }, [query]);

  useEffect(() => {
    if (!query) return;

    const load = async () => {
      setLoading(true);

      try {
        const u = await fetch(`http://localhost:8000/api/uniprot/${query}`);
        const m = await fetch(`http://localhost:8000/api/membrane/${query}`);

        const uniprotData = await u.json();
        const tmhmmData = await m.json();

        setUniprot(uniprotData);
        setTmhmm(tmhmmData);
        setCursor(1);
        setSelectedSegment(null);
      } catch (e) {
        console.error(e);
      }

      setLoading(false);
    };

    load();
  }, [query]);

  const sequenceBlocks = useMemo(() => {
    if (!uniprot?.sequence) return [];

    const blocks = [];
    for (let i = 0; i < uniprot.sequence.length; i += 60) {
      blocks.push({
        index: i + 1,
        text: uniprot.sequence.slice(i, i + 60),
      });
    }

    return blocks;
  }, [uniprot]);

  const hydropathyData = useMemo(() => {
    if (!uniprot?.sequence) return [];
    return computeKyteDoolittle(uniprot.sequence, 9);
  }, [uniprot]);

  const hydropathyStats = useMemo(() => {
    if (!hydropathyData.length) {
      return { min: 0, max: 0, avg: 0 };
    }

    const scores = hydropathyData.map((d) => d.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    return {
      min: Number(min.toFixed(2)),
      max: Number(max.toFixed(2)),
      avg: Number(avg.toFixed(2)),
    };
  }, [hydropathyData]);

  const selectedTM =
    selectedSegment !== null && tmhmm?.tm_segments[selectedSegment]
      ? tmhmm.tm_segments[selectedSegment]
      : null;

  const tmCoverage = useMemo(() => {
    if (!uniprot?.length || !tmhmm?.tm_segments?.length) return 0;

    const total = tmhmm.tm_segments.reduce((sum, seg) => {
      return sum + Math.max(0, seg.end - seg.start + 1);
    }, 0);

    return Math.round((total / uniprot.length) * 100);
  }, [uniprot, tmhmm]);

  const biologicalDecision = useMemo(() => {
    if (!tmhmm || !uniprot) return "";

    if (tmhmm.is_membrane && tmhmm.tm_segments.length >= 6) {
      return "Profil compatible avec une protéine membranaire multi-pass. Les segments TM multiples suggèrent un rôle possible dans le transport, la signalisation ou l’ancrage membranaire.";
    }

    if (tmhmm.is_membrane && tmhmm.tm_segments.length >= 1) {
      return "Profil compatible avec une protéine membranaire. La présence d’au moins un segment transmembranaire soutient une localisation ou un ancrage membranaire.";
    }

    return "Aucun segment transmembranaire clair n’a été détecté. Le profil est plus compatible avec une protéine soluble ou non prioritaire pour l’analyse membranaire.";
  }, [tmhmm, uniprot]);

  const handleSearch = () => {
    if (!input.trim()) return;
    router.push(`/search?q=${encodeURIComponent(input.trim())}`);
  };

  const handleSegmentClick = (index: number, seg: TMSegment) => {
    setSelectedSegment(index);
    setCursor(seg.start);

    setTimeout(() => {
      const el = document.getElementById(`aa-${seg.start}`);
      el?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }, 80);
  };

  const copySequence = async () => {
    if (!uniprot?.sequence) return;

    await navigator.clipboard.writeText(uniprot.sequence);
    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#eaf2fb_0%,#f8fbff_42%,#edf8f2_100%)] p-6 text-slate-900">
      <div className="mx-auto max-w-[1180px] space-y-5">
        <header className="flex items-center justify-between rounded-2xl border border-blue-900 bg-gradient-to-r from-[#0b3c7a] via-[#0e5cad] to-[#15928b] px-6 py-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/15 p-2 text-white">
              <Layers3 size={20} />
            </div>

            <div>
              <p className="text-sm font-semibold text-white">MemProtScope</p>
              <p className="text-xs text-blue-100">
                Analyse biologique — UniProt & DeepTMHMM
              </p>
            </div>
          </div>

          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs text-white transition hover:bg-white/25"
          >
            <ArrowLeft size={14} />
            Accueil
          </button>
        </header>

        <section className="rounded-2xl border border-blue-100 bg-white/90 p-4 shadow-sm">
          <div className="mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              Recherche
            </p>
            <h1 className="text-[20px] font-bold text-slate-900">
              Analyse UniProt + DeepTMHMM
            </h1>
          </div>

          <div className="flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              className="flex-1 rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-2 text-[13px] outline-none focus:border-blue-400 focus:bg-white"
              placeholder="Entrer un ID UniProt..."
            />

            <button
              onClick={handleSearch}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <Search size={16} />
              Rechercher
            </button>
          </div>
        </section>

        {loading && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-center text-sm text-blue-700">
            Chargement des données UniProt et DeepTMHMM...
          </div>
        )}

        {uniprot && tmhmm && (
          <>
            <section className="grid gap-3 lg:grid-cols-4">
              <StatCard
                title="Accession"
                value={uniprot.accession}
                subtitle="Entrée UniProt analysée"
                icon={<Database size={17} />}
                tone="blue"
              />

              <StatCard
                title="Longueur"
                value={`${uniprot.length} aa`}
                subtitle="Séquence protéique"
                icon={<Dna size={17} />}
                tone="violet"
              />

              <StatCard
                title="Membrane"
                value={tmhmm.is_membrane ? "Membrane +" : "Membrane -"}
                subtitle="Résultat DeepTMHMM"
                icon={<Activity size={17} />}
                tone={tmhmm.is_membrane ? "green" : "red"}
              />

              <StatCard
                title="Segments TM"
                value={`${tmhmm.tm_segments.length}`}
                subtitle={`${tmCoverage}% de couverture`}
                icon={<ShieldCheck size={17} />}
                tone="amber"
              />
            </section>

            <section className="rounded-2xl border border-cyan-100 bg-gradient-to-r from-cyan-50 to-blue-50 p-4 shadow-sm">
              <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
                    Décision biologique
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-cyan-950">
                    {biologicalDecision}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <MiniMetric
                    label="TM"
                    value={`${tmhmm.tm_segments.length}`}
                    tone="blue"
                  />
                  <MiniMetric
                    label="Couverture"
                    value={`${tmCoverage}%`}
                    tone="emerald"
                  />
                  <MiniMetric
                    label="KD max"
                    value={`${hydropathyStats.max}`}
                    tone="amber"
                  />
                </div>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <section className="rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-sm">
                  <SectionHeader
                    icon={<Database size={18} />}
                    label="UniProt"
                    title="Informations biologiques"
                    color="blue"
                  />

                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    <InfoBox label="Accession" value={uniprot.accession} />
                    <InfoBox label="Organisme" value={uniprot.organism} />
                    <InfoBox label="Nom" value={uniprot.protein_name} />
                    <InfoBox label="Longueur" value={`${uniprot.length} aa`} />

                    <InfoBox
                      label="Gènes"
                      value={uniprot.gene_names?.join(", ") || "-"}
                    />

                    <InfoBox
                      label="Type d’entrée"
                      value={uniprot.entry_type || "-"}
                    />
                  </div>

                  <div className="mt-3 max-h-[110px] overflow-auto rounded-xl border border-blue-100 bg-blue-50/40 p-3 pr-2 text-[12px] leading-5 text-slate-700">
                    {uniprot.function || "Aucune fonction disponible."}
                  </div>
                </section>

                <section className="rounded-2xl border border-emerald-100 bg-white/95 p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionHeader
                      icon={<Dna size={18} />}
                      label="Séquence"
                      title="Séquence protéique colorée"
                      color="emerald"
                    />

                    <button
                      onClick={copySequence}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100"
                    >
                      {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                      {copied ? "Copié" : "Copier"}
                    </button>
                  </div>

                  <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-[11px] text-slate-600">
                        Curseur de position
                      </label>

                      <span className="rounded-full bg-white px-3 py-1 text-[11px] text-emerald-700 ring-1 ring-emerald-100">
                        AA {cursor}
                      </span>
                    </div>

                    <input
                      type="range"
                      min={1}
                      max={uniprot.length}
                      value={cursor}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setCursor(value);
                        setSelectedSegment(null);

                        setTimeout(() => {
                          const el = document.getElementById(`aa-${value}`);
                          el?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                            inline: "center",
                          });
                        }, 50);
                      }}
                      className="w-full"
                    />
                  </div>

                  <div className="max-h-[300px] overflow-auto rounded-xl border border-emerald-100 bg-[#f8fff9] p-3 font-mono text-[12px] leading-6">
                    {sequenceBlocks.map((b) => (
                      <div
                        key={b.index}
                        className="flex gap-4 whitespace-nowrap"
                      >
                        <span className="w-[60px] shrink-0 text-right text-slate-400">
                          {b.index}
                        </span>

                        <span className="tracking-wide text-slate-800">
                          {b.text.split("").map((aa, idx) => {
                            const position = b.index + idx;

                            const tmIndex = getTMIndex(
                              position,
                              tmhmm.tm_segments
                            );

                            const isTM = tmIndex !== null;
                            const isSelectedTM =
                              selectedSegment !== null &&
                              tmIndex === selectedSegment;
                            const isCursor = position === cursor;

                            return (
                              <span
                                id={`aa-${position}`}
                                key={position}
                                title={`Position ${position}${
                                  isTM ? " - segment TM" : ""
                                }`}
                                className={[
                                  "inline-block px-[1px]",
                                  getAAColor(aa),
                                  isTM ? "ring-1 ring-blue-500" : "",
                                  isSelectedTM
                                    ? "bg-blue-600 text-white ring-2 ring-blue-700"
                                    : "",
                                  isCursor
                                    ? "bg-red-500 text-white ring-2 ring-red-600"
                                    : "",
                                ].join(" ")}
                              >
                                {aa}
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-5 gap-2 text-[10px]">
                    <Legend
                      label="Hydrophobe"
                      className="bg-slate-300 text-slate-800"
                    />
                    <Legend
                      label="Polaire"
                      className="bg-emerald-200 text-emerald-800"
                    />
                    <Legend
                      label="Basique"
                      className="bg-blue-200 text-blue-800"
                    />
                    <Legend
                      label="Acide"
                      className="bg-red-200 text-red-800"
                    />
                    <Legend label="TM" className="bg-blue-600 text-white" />
                  </div>

                  <KyteDoolittleChart
                    data={hydropathyData}
                    segments={tmhmm.tm_segments}
                    length={uniprot.length}
                    stats={hydropathyStats}
                  />
                  </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-2xl border border-cyan-100 bg-white/95 p-4 shadow-sm">
                  <SectionHeader
                    icon={<Activity size={18} />}
                    label="DeepTMHMM"
                    title="Analyse membranaire"
                    color="cyan"
                  />

                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    <InfoBox
                      label="Membrane"
                      value={tmhmm.is_membrane ? "Oui" : "Non"}
                    />
                    <InfoBox label="Type" value={tmhmm.predicted_type || "-"} />
                    <InfoBox
                      label="Segments TM"
                      value={`${tmhmm.tm_segments.length}`}
                    />
                    <InfoBox label="Position curseur" value={`${cursor}`} />
                  </div>

                  <div className="relative mt-4 h-[24px] overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="absolute top-0 z-10 h-full w-[2px] bg-red-500"
                      style={{ left: `${(cursor / uniprot.length) * 100}%` }}
                    />

                    {tmhmm.tm_segments.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSegmentClick(i, s)}
                        className={`absolute top-0 h-full cursor-pointer rounded-full transition ${
                          selectedSegment === i
                            ? "bg-blue-800"
                            : "bg-blue-500 hover:bg-blue-700"
                        }`}
                        style={{
                          left: `${(s.start / uniprot.length) * 100}%`,
                          width: `${
                            ((s.end - s.start + 1) / uniprot.length) * 100
                          }%`,
                        }}
                        title={`TM${i + 1}: ${s.start}-${s.end}`}
                      />
                    ))}
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                    <div className="rounded-lg bg-blue-50 p-2 text-blue-800">
                      Barre bleue : segments TM prédits
                    </div>
                    <div className="rounded-lg bg-red-50 p-2 text-red-800">
                      Trait rouge : position du curseur
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2 text-slate-700">
                      Clic sur TM : zoom sur la séquence
                    </div>
                  </div>

                  <div className="mt-4 max-h-[180px] overflow-auto rounded-xl border border-slate-100">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-cyan-50 text-cyan-900">
                          <th className="p-2 text-left">Segment</th>
                          <th className="p-2 text-left">Début</th>
                          <th className="p-2 text-left">Fin</th>
                          <th className="p-2 text-left">Longueur</th>
                          <th className="p-2 text-left">%</th>
                          <th className="p-2 text-left">Action</th>
                        </tr>
                      </thead>

                      <tbody>
                        {tmhmm.tm_segments.length > 0 ? (
                          tmhmm.tm_segments.map((s, i) => (
                            <tr
                              key={i}
                              className={`border-b border-slate-100 ${
                                selectedSegment === i ? "bg-blue-50" : "bg-white"
                              }`}
                            >
                              <td className="p-2 font-medium text-blue-800">
                                TM{i + 1}
                              </td>
                              <td className="p-2">{s.start}</td>
                              <td className="p-2">{s.end}</td>
                              <td className="p-2">{s.end - s.start + 1} aa</td>
                              <td className="p-2">
                                {Math.round(
                                  ((s.end - s.start + 1) / uniprot.length) * 100
                                )}
                                %
                              </td>
                              <td className="p-2">
                                <button
                                  onClick={() => handleSegmentClick(i, s)}
                                  className="rounded-lg bg-blue-600 px-2 py-1 text-[10px] text-white hover:bg-blue-700"
                                >
                                  Zoom
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={6}
                              className="p-3 text-center text-slate-500"
                            >
                              Aucun segment TM détecté.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {selectedTM && (
                    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-800">
                      Segment sélectionné : TM{selectedSegment! + 1} — positions{" "}
                      {selectedTM.start} à {selectedTM.end}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-violet-100 bg-white/95 p-4 shadow-sm">
                  <SectionHeader
                    icon={<Info size={18} />}
                    label="Résumé"
                    title="Résumé membranaire"
                    color="violet"
                  />

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-[12px]">
                      <tbody>
                        <MembraneRow
                          tone="emerald"
                          label="Statut membranaire"
                          value={
                            tmhmm.is_membrane
                              ? "Protéine membranaire"
                              : "Non membranaire"
                          }
                        />
                        <MembraneRow
                          tone="blue"
                          label="Type prédit"
                          value={tmhmm.predicted_type || "Indéterminé"}
                        />
                        <MembraneRow
                          tone="violet"
                          label="Segments TM"
                          value={`${tmhmm.tm_segments.length}`}
                        />
                        <MembraneRow
                          tone="rose"
                          label="Couverture TM"
                          value={`${tmCoverage}% de la séquence`}
                        />
                        <MembraneRow
                          tone="amber"
                          label="Hydrophobicité max"
                          value={`${hydropathyStats.max}`}
                        />
                        <MembraneRow
                          tone="emerald"
                          label="Interprétation"
                          value={
                            tmhmm.is_membrane
                              ? "Les zones hydrophobes et les segments TM soutiennent une organisation membranaire."
                              : "Le profil ne montre pas de signature transmembranaire nette."
                          }
                        />
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-cyan-50 p-4 shadow-sm">
                  <p className="text-[12px] leading-5 text-blue-900">
                    {tmhmm.is_membrane
                      ? "La protéine peut être envoyée vers la page Structure pour rechercher des structures PDB ou utiliser AlphaFold en fallback."
                      : "La protéine semble non membranaire. La page Structure reste accessible, mais le pipeline membrane n’est pas prioritaire."}
                  </p>

                  <button
                    onClick={() =>
                      router.push(`/structures/${uniprot.accession}`)
                    }
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-[13px] font-semibold text-white shadow-sm hover:bg-blue-700"
                  >
                    Continuer vers Structures
                    <ArrowRight size={16} />
                  </button>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KyteDoolittleChart({
  data,
  segments,
  length,
  stats,
}: {
  data: { position: number; score: number }[];
  segments: TMSegment[];
  length: number;
  stats: { min: number; max: number; avg: number };
}) {
  const width = 680;
  const height = 170;
  const baseline = 85;
  const scaleY = 22;

  return (
    <div className="mt-4 rounded-xl border border-blue-100 bg-gradient-to-br from-white to-blue-50/60 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Waves size={16} className="text-blue-700" />
            <h3 className="text-[13px] font-semibold text-slate-800">
              Courbe Kyte-Doolittle
            </h3>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Profil d’hydrophobicité avec fenêtre mobile de 9 acides aminés.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <MiniMetric label="Min" value={`${stats.min}`} tone="rose" />
          <MiniMetric label="Moy" value={`${stats.avg}`} tone="slate" />
          <MiniMetric label="Max" value={`${stats.max}`} tone="blue" />
        </div>
      </div>

      <div className="h-[190px] w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
          <rect x="0" y="0" width={width} height={height} fill="#ffffff" />

          {[20, 50, 85, 120, 150].map((y) => (
            <line
              key={y}
              x1="38"
              y1={y}
              x2={width - 18}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
          ))}

          <line
            x1="38"
            y1={baseline}
            x2={width - 18}
            y2={baseline}
            stroke="#64748b"
            strokeWidth="1.2"
          />

          <text x="4" y={baseline + 4} fontSize="10" fill="#64748b">
            0
          </text>
          <text x="4" y="25" fontSize="10" fill="#64748b">
            +3
          </text>
          <text x="4" y="150" fontSize="10" fill="#64748b">
            -3
          </text>

          <line
            x1="38"
            y1={baseline - 1.6 * scaleY}
            x2={width - 18}
            y2={baseline - 1.6 * scaleY}
            stroke="#f59e0b"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          <text
            x={width - 155}
            y={baseline - 1.6 * scaleY - 5}
            fontSize="10"
            fill="#b45309"
          >
            seuil hydrophobe ≈ +1.6
          </text>

          {segments.map((seg, i) => {
            const x =
              38 + ((seg.start - 1) / Math.max(length - 1, 1)) * (width - 56);
            const w = ((seg.end - seg.start + 1) / length) * (width - 56);

            return (
              <g key={i}>
                <rect
                  x={x}
                  y="12"
                  width={w}
                  height={height - 34}
                  fill="#bfdbfe"
                  opacity="0.42"
                />
                <text
                  x={x + 3}
                  y="23"
                  fontSize="9"
                  fill="#1d4ed8"
                  fontWeight="600"
                >
                  TM{i + 1}
                </text>
              </g>
            );
          })}

          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
            points={data
              .map((d, i) => {
                const x =
                  38 + (i / Math.max(data.length - 1, 1)) * (width - 56);
                const y = baseline - d.score * scaleY;
                return `${x},${Math.max(12, Math.min(height - 22, y))}`;
              })
              .join(" ")}
          />

          <text x="38" y={height - 5} fontSize="10" fill="#64748b">
            1
          </text>
          <text
            x={width / 2 - 20}
            y={height - 5}
            fontSize="10"
            fill="#64748b"
          >
            position AA
          </text>
          <text x={width - 45} y={height - 5} fontSize="10" fill="#64748b">
            {length}
          </text>
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-lg bg-blue-50 p-2 text-blue-800">
          Zones bleues : segments TM prédits.
        </div>
        <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
          Ligne pointillée : seuil hydrophobe indicatif.
        </div>
        <div className="rounded-lg bg-slate-50 p-2 text-slate-700">
          Pics positifs : régions hydrophobes.
        </div>
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "rose" | "slate" | "emerald" | "amber";
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-800",
    rose: "bg-rose-50 text-rose-800",
    slate: "bg-slate-50 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-800",
    amber: "bg-amber-50 text-amber-800",
  };

  return (
    <div className={`rounded-lg px-2 py-1 text-center ${styles[tone]}`}>
      <p className="text-[9px] uppercase tracking-[0.12em]">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function getTMIndex(position: number, segments: TMSegment[]) {
  const index = segments.findIndex(
    (seg) => position >= seg.start && position <= seg.end
  );

  return index === -1 ? null : index;
}

function getAAColor(aa: string) {
  const hydrophobic = "AVLIMFWP";
  const polar = "GSTYC";
  const positive = "KRH";
  const negative = "DE";
  const amide = "NQ";

  if (hydrophobic.includes(aa)) return "bg-slate-200 text-slate-900";
  if (polar.includes(aa)) return "bg-emerald-100 text-emerald-900";
  if (positive.includes(aa)) return "bg-blue-100 text-blue-900";
  if (negative.includes(aa)) return "bg-red-100 text-red-900";
  if (amide.includes(aa)) return "bg-purple-100 text-purple-900";

  return "bg-gray-100 text-gray-900";
}

function computeKyteDoolittle(sequence: string, windowSize = 9) {
  const scale: Record<string, number> = {
    I: 4.5,
    V: 4.2,
    L: 3.8,
    F: 2.8,
    C: 2.5,
    M: 1.9,
    A: 1.8,
    G: -0.4,
    T: -0.7,
    S: -0.8,
    W: -0.9,
    Y: -1.3,
    P: -1.6,
    H: -3.2,
    E: -3.5,
    Q: -3.5,
    D: -3.5,
    N: -3.5,
    K: -3.9,
    R: -4.5,
  };

  const half = Math.floor(windowSize / 2);

  return sequence.split("").map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(sequence.length, i + half + 1);
    const window = sequence.slice(start, end);

    const total = window
      .split("")
      .reduce((sum, aa) => sum + (scale[aa] ?? 0), 0);

    return {
      position: i + 1,
      score: total / window.length,
    };
  });
}

function SectionHeader({
  icon,
  label,
  title,
  color = "blue",
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  color?: "blue" | "emerald" | "cyan" | "violet";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    cyan: "bg-cyan-50 text-cyan-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <div className="mb-3 flex items-center gap-2">
      <div className={`rounded-xl p-2 ${colors[color]}`}>{icon}</div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </p>
        <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="truncate text-[12px] font-medium text-slate-900">
        {value}
      </p>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  tone: "blue" | "green" | "violet" | "amber" | "red";
}) {
  const styles = {
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
    violet: "bg-violet-50 border-violet-100 text-violet-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    red: "bg-red-50 border-red-100 text-red-700",
  };

  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${styles[tone]}`}>
      <div className="mb-2 inline-flex rounded-xl bg-white/70 p-2">{icon}</div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <p className="mt-1 text-[16px] font-bold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{subtitle}</p>
    </div>
  );
}

function MembraneRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "blue" | "violet" | "amber" | "rose";
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-900",
    blue: "bg-blue-50 text-blue-900",
    violet: "bg-violet-50 text-violet-900",
    amber: "bg-amber-50 text-amber-900",
    rose: "bg-rose-50 text-rose-900",
  };

  return (
    <tr className={`${tones[tone]} border-b border-white`}>
      <td className="w-[42%] p-3 font-semibold">{label}</td>
      <td className="p-3">{value}</td>
    </tr>
  );
}

function Legend({ label, className }: { label: string; className: string }) {
  return (
    <div className={`rounded-lg px-2 py-1 text-center font-medium ${className}`}>
      {label}
    </div>
  );
}