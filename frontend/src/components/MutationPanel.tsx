"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CircleHelp, FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { gradeColor } from "@/lib/conservation";
import { variantLabel } from "@/lib/annotations";
import { AA_CLASS, AMINO_ACIDS, CLASS_COLORS, fetchMutation, type Hypothesis, type MutationAnalysis } from "@/lib/mutation";
import { EvidenceBadge } from "@/components/FunctionalAnnotation";

const ROW = 50;
const fmt = (v: number, digits = 1) => (v > 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`);

const GROUPS: { kind: Hypothesis["kind"]; title: string; icon: React.ReactNode; tone: string }[] = [
  { kind: "documente", title: "Déjà documenté", icon: <BookOpen size={15} />, tone: "border-blue-200 bg-blue-50 text-blue-900" },
  { kind: "attention", title: "Arguments pour un effet possible", icon: <AlertTriangle size={15} />, tone: "border-amber-200 bg-amber-50 text-amber-900" },
  { kind: "modere", title: "Arguments pour une substitution tolérée", icon: <ShieldCheck size={15} />, tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  { kind: "incertain", title: "Incertitudes", icon: <CircleHelp size={15} />, tone: "border-slate-200 bg-slate-50 text-slate-800" },
];

/**
 * Onglet Mutations : choix d'un résidu et d'une substitution, puis
 * propriétés, conservation, environnement 3D, contacts et annotations. Les
 * conséquences sont présentées comme des hypothèses, sans verdict.
 */
export default function MutationPanel({
  accession,
  sequence,
  onFocus,
}: {
  accession: string;
  sequence: string;
  onFocus: (positions: number[], label: string, color: string) => void;
}) {
  const [position, setPosition] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const p = Number(new URLSearchParams(window.location.search).get("pos"));
    return p >= 1 && p <= sequence.length ? p : null;
  });
  const [mutant, setMutant] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const to = new URLSearchParams(window.location.search).get("to")?.toUpperCase() ?? "";
    return AMINO_ACIDS.includes(to) && to.length === 1 ? to : null;
  });
  const [state, setState] = useState<{ key: string; data: MutationAnalysis | null; error: string | null }>({ key: "", data: null, error: null });
  const [refresh, setRefresh] = useState(0);
  const wild = position ? sequence[position - 1] : null;
  const key = position && mutant && mutant !== wild ? `${position}${mutant}` : "";

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchMutation(accession, position!, mutant!)
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((e) => !cancelled && setState({ key, data: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [accession, key, position, mutant, refresh]);

  const data = state.key === key ? state.data : null;
  const error = state.key === key ? state.error : null;
  const loading = !!key && state.key !== key;

  // Conservation encore en calcul : nouvelle demande quelques secondes plus tard
  const pending = data && ["queued", "running"].includes(data.conservation.status);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setRefresh((r) => r + 1), 6000);
    return () => clearTimeout(timer);
  }, [pending, refresh]);

  // Résidu et ses contacts en 3D
  useEffect(() => {
    if (!data) return;
    const contacts = data.environment.available ? data.environment.contacts.map((c) => c.resi) : [];
    onFocus([data.position, ...contacts], `${data.label} et contacts`, "#7c3aed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const choose = (p: number) => {
    setPosition(p);
    if (mutant === sequence[p - 1]) setMutant(null);
  };

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Proposer une substitution</h3>
        <p className="text-[13px] text-slate-500">Cliquez un résidu dans la séquence (numérotation UniProt), puis l’acide aminé à introduire.</p>
        <SequencePicker sequence={sequence} position={position} onPick={choose} />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <label className="flex items-center gap-1.5">
            Position
            <input
              type="number"
              min={1}
              max={sequence.length}
              value={position ?? ""}
              onChange={(e) => {
                const p = Number(e.target.value);
                if (p >= 1 && p <= sequence.length) choose(p);
              }}
              className="w-20 rounded-xl border border-slate-300 px-2 py-1 tabular-nums"
            />
          </label>
          {wild && (
            <span className="font-mono text-[14px]">
              résidu sauvage <b>{wild}</b>
              {position} ({AA_CLASS[wild]})
            </span>
          )}
        </div>
        {wild && (
          <div className="mt-2 flex flex-wrap gap-1">
            {AMINO_ACIDS.split("").map((aa) => (
              <button
                key={aa}
                disabled={aa === wild}
                onClick={() => setMutant(aa)}
                title={`${aa} : ${AA_CLASS[aa]}`}
                className={`h-8 w-8 rounded font-mono text-[14px] font-bold disabled:cursor-not-allowed disabled:opacity-30 ${mutant === aa ? "text-white ring-2 ring-slate-900" : "hover:opacity-80"}`}
                style={{ backgroundColor: mutant === aa ? CLASS_COLORS[AA_CLASS[aa]] : `${CLASS_COLORS[AA_CLASS[aa]]}22`, color: mutant === aa ? "#ffffff" : CLASS_COLORS[AA_CLASS[aa]] }}
              >
                {aa}
              </button>
            ))}
          </div>
        )}
        {wild && (
          <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate-600">
            {Object.entries(CLASS_COLORS).map(([name, color]) => (
              <span key={name} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                {name}
              </span>
            ))}
          </div>
        )}
      </section>

      {loading && (
        <div className="flex items-center gap-2 card p-4 text-[14px] text-slate-500">
          <Loader2 size={15} className="animate-spin text-blue-600" />
          Analyse de la substitution…
        </div>
      )}
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[14px] text-rose-800">{error}</p>}
      {data && <Analysis data={data} onPickMutant={setMutant} onFocus={onFocus} />}
    </div>
  );
}

function SequencePicker({ sequence, position, onPick }: { sequence: string; position: number | null; onPick: (p: number) => void }) {
  const rows = useMemo(() => Array.from({ length: Math.ceil(sequence.length / ROW) }, (_, k) => k * ROW), [sequence]);
  return (
    <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200 p-2 font-mono text-[12px]">
      {rows.map((start) => (
        <div key={start} className="flex">
          <span className="w-12 shrink-0 pr-2 text-right text-slate-400">{start + 1}</span>
          <span>
            {sequence
              .slice(start, start + ROW)
              .split("")
              .map((aa, k) => {
                const p = start + k + 1;
                return (
                  <span
                    key={p}
                    onClick={() => onPick(p)}
                    title={`${aa}${p}`}
                    className={`inline-block w-[11px] cursor-pointer text-center ${p === position ? "rounded-sm bg-violet-600 font-bold text-white" : "hover:bg-violet-100"} ${(k + 1) % 10 === 0 ? "mr-1" : ""}`}
                  >
                    {aa}
                  </span>
                );
              })}
          </span>
        </div>
      ))}
    </div>
  );
}

function Analysis({ data, onPickMutant, onFocus }: { data: MutationAnalysis; onPickMutant: (aa: string) => void; onFocus: (positions: number[], label: string, color: string) => void }) {
  const p = data.properties;
  const c = data.conservation;
  const env = data.environment;
  const notes = data.annotations;
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-violet-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="font-mono text-[24px] font-bold text-violet-800">{data.label}</h3>
          <span className="text-[14px] text-slate-600">
            {p.wild.name} → {p.mutant.name}
          </span>
          <span className="font-mono text-[13px] text-slate-500">
            {data.context.split("").map((ch, k) => (
              <span key={k} className={ch === ch.toUpperCase() ? "font-bold text-violet-700" : ""}>
                {ch.toUpperCase()}
              </span>
            ))}
          </span>
        </div>
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-5 text-slate-700">
          <b>Hypothèses, pas des prédictions.</b> Les éléments ci-dessous décrivent la substitution et son contexte. Ils ne permettent pas
          de dire si la mutation est délétère, neutre ou si elle modifie la fonction : seule l’expérience permet de conclure.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {GROUPS.map((group) => {
            const items = data.hypotheses.filter((h) => h.kind === group.kind);
            if (!items.length) return null;
            return (
              <div key={group.kind} className={`rounded-lg border p-3 ${group.tone}`}>
                <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                  {group.icon}
                  {group.title}
                </p>
                <ul className="mt-1 space-y-1.5 text-[13px] leading-5">
                  {items.map((h, k) => (
                    <li key={k}>
                      <b>{h.title}.</b> {h.text}
                      {h.test && <span className="block text-[12px] opacity-80">Pour vérifier : {h.test}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {data.hypotheses.length === 0 && <p className="text-[13px] text-slate-600">Aucun argument particulier dans les données disponibles : cela ne signifie pas que la substitution est sans effet.</p>}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-4">
          <h3 className="text-[16px] font-semibold text-slate-900">Propriétés physico-chimiques</h3>
          <table className="mt-2 w-full text-[13px]">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 font-semibold" />
                <th className="py-1 text-right font-semibold">{p.wild.aa} (sauvage)</th>
                <th className="py-1 text-right font-semibold">{p.mutant.aa} (proposé)</th>
                <th className="py-1 text-right font-semibold">Changement</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Classe" a={p.wild.class} b={p.mutant.class} delta={p.class_change ? "change" : "identique"} />
              <Row label="Hydropathie (Kyte-Doolittle)" a={p.wild.hydropathy.toFixed(1)} b={p.mutant.hydropathy.toFixed(1)} delta={fmt(p.delta_hydropathy)} />
              <Row label="Volume (Å³)" a={p.wild.volume.toFixed(0)} b={p.mutant.volume.toFixed(0)} delta={fmt(p.delta_volume, 0)} />
              <Row label="Charge à pH 7" a={`${p.wild.charge}`} b={`${p.mutant.charge}`} delta={p.delta_charge ? fmt(p.delta_charge, 0) : "0"} />
            </tbody>
          </table>
          <p className="mt-2 text-[13px] text-slate-700">
            BLOSUM62 : <b>{p.blosum62}</b> ({p.blosum62 > 0 ? "substitution fréquente entre protéines apparentées" : p.blosum62 === 0 ? "neutre" : "substitution rare entre protéines apparentées"}) · distance de Grantham : <b>{p.grantham}</b> (
            {p.grantham_class})
          </p>
        </section>

        <section className="card p-4">
          <h3 className="text-[16px] font-semibold text-slate-900">Conservation évolutive</h3>
          {["queued", "running"].includes(c.status) ? (
            <p className="mt-2 flex items-center gap-2 text-[14px] text-slate-600">
              <Loader2 size={14} className="animate-spin" /> Calcul de la conservation en cours (homologues UniRef50) : mise à jour automatique.
            </p>
          ) : !c.available ? (
            <p className="mt-2 text-[14px] text-slate-600">Conservation indisponible{c.error ? ` : ${c.error}` : ""}.</p>
          ) : (
            <>
              <p className="mt-2 flex items-center gap-2 text-[14px]">
                Grade
                <span className="rounded px-2 py-0.5 font-bold" style={{ backgroundColor: gradeColor(c.grade!), color: c.grade! >= 8 ? "#ffffff" : "#0f172a" }}>
                  {c.grade}/9
                </span>
                <span className="text-slate-500">({c.sequences} séquences ; 9 = très conservé)</span>
              </p>
              <p className="mt-2 text-[13px] text-slate-600">Acides aminés observés chez les homologues à cette position :</p>
              <ul className="mt-1 space-y-1">
                {(c.observed ?? []).map((r) => (
                  <li key={r.residue} className="grid grid-cols-[24px_1fr_48px] items-center gap-2 text-[13px]">
                    <span className={`font-mono font-bold ${r.residue === data.mutant ? "text-violet-700" : ""}`}>{r.residue}</span>
                    <span className="h-3 rounded bg-slate-100">
                      <span className="block h-3 rounded" style={{ width: `${r.frequency * 100}%`, backgroundColor: r.residue === data.mutant ? "#7c3aed" : "#94a3b8" }} />
                    </span>
                    <span className="text-right tabular-nums">{pct(r.frequency)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-slate-700">
                {data.mutant} chez les homologues : <b>{pct(data.mutant_homolog_frequency)}</b>
                {(data.mutant_homolog_frequency ?? 0) === 0 && " (non observé parmi les résidus les plus fréquents)"}.
              </p>
            </>
          )}
        </section>
      </div>

      <section className="card p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Environnement structural et contacts locaux</h3>
        <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Membrane (UniProt)" value={data.membrane.zone === "transmembranaire" || data.membrane.zone === "intramembranaire" ? `${data.membrane.zone} ${data.membrane.segment}${data.membrane.core ? ", cœur de la bicouche" : ", près de l’interface"}` : data.membrane.zone === "hors membrane" ? `hors membrane (${data.membrane.side})` : "non annotée"} />
          {env.available ? (
            <>
              <Fact label="Confiance du modèle (pLDDT)" value={`${env.plddt != null ? Math.round(env.plddt) : "—"}${env.reliable ? "" : " : peu fiable"}`} />
              <Fact label="Enfouissement" value={`${env.burial} (${env.neighbours} voisins à 10 Å)`} />
              <Fact label="Structure secondaire" value={env.secondary} />
            </>
          ) : (
            <Fact label="Modèle 3D" value={env.reason} />
          )}
        </dl>
        {env.available && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-semibold">Résidu voisin</th>
                  <th className="py-1 pr-3 text-right font-semibold">Distance</th>
                  <th className="py-1 pr-3 font-semibold">Nature probable du contact</th>
                  <th className="py-1 font-semibold">Avec {data.mutant}</th>
                </tr>
              </thead>
              <tbody>
                {env.contacts.map((contact) => (
                  <tr key={contact.resi} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onFocus([data.position, contact.resi], `${data.wild}${data.position} – ${contact.aa}${contact.resi}`, "#7c3aed")}>
                    <td className="py-1 pr-3 font-mono font-semibold">
                      {contact.aa}
                      {contact.resi}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{contact.distance} Å</td>
                    <td className="py-1 pr-3">{contact.kinds.join(", ")}</td>
                    <td className={`py-1 ${contact.at_risk.length ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                      {contact.at_risk.length ? `${contact.at_risk.join(", ")} probablement perdu(e)` : "compatible a priori"}
                    </td>
                  </tr>
                ))}
                {env.contacts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-slate-500">
                      Aucun résidu à moins de 4,5 Å de la chaîne latérale.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-1 text-[12px] text-slate-500">
              Atomes lourds à moins de 4,5 Å de la chaîne latérale dans le modèle {env.model_id}. Nature du contact déduite des atomes et des
              distances (pont salin ≤ 4 Å, liaison hydrogène ≤ 3,5 Å…) : indicative, le modèle ne place pas les hydrogènes.
            </p>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Annotations fonctionnelles disponibles</h3>
        <div className="mt-2 grid gap-3 text-[13px] lg:grid-cols-2">
          <div>
            <p className="font-semibold text-slate-800">À cette position</p>
            <ul className="mt-1 space-y-1">
              {notes.at_site.map((s, k) => (
                <li key={k} className="flex flex-wrap items-center gap-1.5">
                  {s.type}
                  {s.ligand && <span className="text-slate-600">({s.ligand})</span>}
                  <EvidenceBadge experimental={s.experimental} label={s.evidence_label} />
                </li>
              ))}
              {notes.ptms.map((m, k) => (
                <li key={`ptm-${k}`} className="flex flex-wrap items-center gap-1.5">
                  {m.type} {m.description && <span className="text-slate-600">: {m.description}</span>}
                  <EvidenceBadge experimental={m.experimental} label={m.evidence_label} />
                </li>
              ))}
              {notes.at_site.length + notes.ptms.length === 0 && <li className="text-slate-500">Aucun site ni modification annoté.</li>}
            </ul>
            <p className="mt-2 font-semibold text-slate-800">À proximité</p>
            <ul className="mt-1 space-y-1">
              {notes.nearby_sites.map((s, k) => (
                <li key={k} className="flex flex-wrap items-center gap-1.5">
                  <button onClick={() => onFocus([data.position, s.start], `${s.type} ${s.start}`, "#2563eb")} className="font-mono text-blue-700 hover:underline">
                    {s.start}
                  </button>
                  {s.type}
                  {s.ligand && <span className="text-slate-600">({s.ligand})</span>}
                  <span className="text-[12px] text-slate-500">proche en {s.proximity === "3D" ? "3D (≤ 6 Å)" : "séquence (± 3)"}</span>
                </li>
              ))}
              {notes.nearby_sites.length === 0 && <li className="text-slate-500">Aucun site annoté à proximité.</li>}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Variants documentés à cette position</p>
            <ul className="mt-1 space-y-1">
              {notes.documented_variants.map((v, k) => {
                const same = v.alternatives.includes(data.mutant);
                return (
                  <li key={k} className={same ? "rounded bg-blue-50 px-1" : ""}>
                    <span className="font-mono font-semibold">{variantLabel(v)}</span> · {v.kind}
                    {same && <b className="text-blue-800"> (même substitution)</b>} — {v.description ?? "effet non décrit"}{" "}
                    <EvidenceBadge experimental={v.experimental} label={v.evidence_label} />
                  </li>
                );
              })}
              {notes.documented_variants.length === 0 && <li className="text-slate-500">Aucun variant ni mutagenèse documentés dans UniProt.</li>}
            </ul>
            <p className="mt-2 font-semibold text-slate-800">Domaines et familles</p>
            <p className="mt-1 text-slate-600">{notes.domains.length ? notes.domains.map((d) => `${d.name} (${d.database} ${d.accession})`).join(" · ") : "Aucune signature InterPro à cette position."}</p>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h3 className="text-[16px] font-semibold text-slate-900">Les 19 substitutions possibles à la position {data.position}</h3>
        <p className="text-[13px] text-slate-500">Mesures simples, sans classement par « gravité ». Cliquez une ligne pour l’analyser.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 font-semibold">Acide aminé</th>
                <th className="py-1 text-right font-semibold">BLOSUM62</th>
                <th className="py-1 text-right font-semibold">Grantham</th>
                <th className="py-1 text-right font-semibold">Δ hydropathie</th>
                <th className="py-1 text-right font-semibold">Δ volume</th>
                <th className="py-1 text-right font-semibold">Chez les homologues</th>
              </tr>
            </thead>
            <tbody>
              {data.profile.map((row) => (
                <tr key={row.aa} onClick={() => onPickMutant(row.aa)} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${row.aa === data.mutant ? "bg-violet-50" : ""}`}>
                  <td className="py-1 font-mono font-bold" style={{ color: CLASS_COLORS[AA_CLASS[row.aa]] }}>
                    {data.wild}
                    {data.position}
                    {row.aa}
                  </td>
                  <td className="py-1 text-right tabular-nums">{row.blosum62}</td>
                  <td className="py-1 text-right tabular-nums">{row.grantham}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(row.delta_hydropathy)}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(row.delta_volume, 0)}</td>
                  <td className="py-1 text-right tabular-nums">{row.homolog_frequency == null ? "—" : pct(row.homolog_frequency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-900">
          <FlaskConical size={15} />
          Ce que cette analyse ne peut pas dire
        </h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-5 text-slate-700">
          {data.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({ label, a, b, delta }: { label: string; a: string; b: string; delta: string }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1 text-slate-600">{label}</td>
      <td className="py-1 text-right tabular-nums">{a}</td>
      <td className="py-1 text-right tabular-nums">{b}</td>
      <td className="py-1 text-right font-semibold tabular-nums">{delta}</td>
    </tr>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
