"use client";

import { useState } from "react";
import { Cpu, ExternalLink, FlaskConical, Loader2, Tags } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import { referenceUrl, useAnnotations, variantLabel, type FunctionalAnnotation as Annotation, type Reference } from "@/lib/annotations";

type View = "go" | "sites" | "variants";

/** Badge de preuve : expérimentale, ou prédiction / inférence (avec le détail). */
export function EvidenceBadge({ experimental, label, code }: { experimental: boolean; label: string; code?: string }) {
  return (
    <span
      title={code ? `${label} (code ${code})` : label}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-semibold ${
        experimental ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"
      }`}
    >
      {experimental ? <FlaskConical size={12} /> : <Cpu size={12} />}
      {experimental ? "Expérimental" : label}
      {code && <span className="font-mono font-normal opacity-70">{code}</span>}
    </span>
  );
}

function References({ refs }: { refs: Reference[] }) {
  if (!refs.length) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {refs.slice(0, 3).map((r) => {
        const url = referenceUrl(r);
        return url ? (
          <a key={`${r.source}-${r.id}`} href={url} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-blue-700 hover:underline">
            {r.source === "PubMed" ? `PMID ${r.id}` : `${r.source} ${r.id}`}
          </a>
        ) : (
          <span key={`${r.source}-${r.id}`} className="font-mono text-[12px] text-slate-500">
            {r.source} {r.id}
          </span>
        );
      })}
      {refs.length > 3 && <span className="text-[12px] text-slate-400">+{refs.length - 3}</span>}
    </span>
  );
}

/**
 * Annotation fonctionnelle d'une entrée UniProt (page Recherche) : Gene
 * Ontology, résidus catalytiques et sites de liaison, variants fonctionnels.
 * Les positions et les domaines InterPro sont dans Structures → Domaines.
 */
export default function FunctionalAnnotation({ accession }: { accession: string }) {
  const { data, error, loading } = useAnnotations(accession);
  const [view, setView] = useState<View>("go");
  const [experimentalOnly, setExperimentalOnly] = useState(false);

  if (loading)
    return (
      <div className="flex items-center gap-2 card p-4 text-[14px] text-slate-500">
        <Loader2 size={15} className="animate-spin text-blue-600" />
        Chargement de l’annotation fonctionnelle (UniProt, InterPro)…
      </div>
    );
  if (error || !data) return <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[14px] text-amber-900">Annotation fonctionnelle indisponible : {error}</p>;

  const s = data.summary;
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-emerald-600 p-2 text-white shadow-sm">
            <Tags size={16} />
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-emerald-700">UniProtKB · InterPro · Gene Ontology</p>
            <h2 className="text-[17px] font-semibold text-slate-900">Annotation fonctionnelle</h2>
          </div>
        </div>
        <span className={`rounded px-2 py-1 text-[12px] font-semibold ${data.reviewed ? "bg-blue-50 text-blue-800" : "bg-amber-50 text-amber-800"}`}>{data.uniprot_status}</span>
      </div>

      <div className="grid gap-2 px-4 pt-3 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
        <Count label="Termes Gene Ontology" total={s.go.total} experimental={s.go.experimental} />
        <Count label="Résidus catalytiques et sites" total={s.sites.total} experimental={s.sites.experimental} detail={`${s.catalytic} catalytique(s), ${s.binding} de liaison`} />
        <Count label="Variants fonctionnels" total={s.functional_variants} experimental={data.variants.filter((v) => v.functional && v.experimental).length} detail={`${s.variants.total} variant(s) au total`} />
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-slate-500">Signatures InterPro</p>
          <p className="text-[17px] font-semibold text-slate-900">{s.signatures}</p>
          <p className="text-[12px] text-slate-500">{s.databases.join(", ") || (data.interpro.available ? "aucune" : "InterPro injoignable")} · positions dans Structures → Domaines</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <SegmentedControl
          label="Annotation"
          value={view}
          onChange={setView}
          options={[
            { value: "go", label: `Gene Ontology (${s.go.total})` },
            { value: "sites", label: `Sites (${s.sites.total})` },
            { value: "variants", label: `Variants (${s.functional_variants})` },
          ]}
        />
        <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
          <input type="checkbox" checked={experimentalOnly} onChange={(e) => setExperimentalOnly(e.target.checked)} />
          Preuves expérimentales seulement
        </label>
      </div>

      <div className="max-h-[420px] overflow-auto border-t border-slate-100">
        {view === "go" && <GoTable data={data} experimentalOnly={experimentalOnly} />}
        {view === "sites" && <SitesTable data={data} experimentalOnly={experimentalOnly} />}
        {view === "variants" && <VariantsTable data={data} experimentalOnly={experimentalOnly} />}
      </div>

      <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-[12px] leading-5 text-slate-500">
        <p>
          <EvidenceBadge experimental label="Expérimental" /> : preuve expérimentale (code GO EXP, IDA, IMP… ou ECO:0000269) ou
          observation dans une structure. <EvidenceBadge experimental={false} label="Prédiction / inférence" /> : similarité, phylogénie,
          analyse de séquence ou annotation électronique automatique (IEA), à confirmer.
        </p>
        <p>
          Sources :{" "}
          {data.sources.map((source, k) => (
            <span key={source.name}>
              {k > 0 && " · "}
              <a href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">
                {source.name}
              </a>{" "}
              ({source.detail})
            </span>
          ))}
          .
        </p>
      </div>
    </section>
  );
}

function Count({ label, total, experimental, detail }: { label: string; total: number; experimental: number; detail?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-slate-500">{label}</p>
      <p className="text-[17px] font-semibold text-slate-900">
        {total} <span className="text-[13px] font-normal text-emerald-700">dont {experimental} expérimental(aux)</span>
      </p>
      {detail && <p className="text-[12px] text-slate-500">{detail}</p>}
    </div>
  );
}

const th = "px-3 py-1.5 text-left font-semibold";

function GoTable({ data, experimentalOnly }: { data: Annotation; experimentalOnly: boolean }) {
  const terms = data.go.filter((t) => !experimentalOnly || t.experimental);
  if (!terms.length) return <Empty text={experimentalOnly ? "Aucun terme GO à preuve expérimentale." : "Aucun terme Gene Ontology."} />;
  return (
    <table className="w-full text-[13px]">
      <thead className="sticky top-0 bg-slate-50 text-slate-500">
        <tr>
          <th className={th}>Aspect</th>
          <th className={th}>Terme</th>
          <th className={th}>Preuve</th>
          <th className={th}>Attribué par</th>
        </tr>
      </thead>
      <tbody>
        {terms.map((t) => (
          <tr key={`${t.id}-${t.evidence_code}`} className="border-t border-slate-100">
            <td className="px-3 py-1.5 text-slate-500">{t.aspect_label}</td>
            <td className="px-3 py-1.5">
              <a href={t.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-900 hover:text-blue-700 hover:underline">
                {t.name} <span className="font-mono text-[11px] text-slate-400">{t.id}</span>
                <ExternalLink size={10} />
              </a>
            </td>
            <td className="px-3 py-1.5">
              <EvidenceBadge experimental={t.experimental} label={t.evidence_label} code={t.evidence_code} />
            </td>
            <td className="px-3 py-1.5 text-slate-500">{t.assigned_by ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SitesTable({ data, experimentalOnly }: { data: Annotation; experimentalOnly: boolean }) {
  const sites = data.sites.filter((s) => !experimentalOnly || s.experimental);
  if (!sites.length) return <Empty text={experimentalOnly ? "Aucun site à preuve expérimentale." : "Aucun résidu catalytique ni site de liaison annoté dans UniProt."} />;
  return (
    <table className="w-full text-[13px]">
      <thead className="sticky top-0 bg-slate-50 text-slate-500">
        <tr>
          <th className={th}>Type</th>
          <th className={th}>Position</th>
          <th className={th}>Ligand ou rôle</th>
          <th className={th}>Preuve</th>
          <th className={th}>Références</th>
        </tr>
      </thead>
      <tbody>
        {sites.map((s, k) => (
          <tr key={k} className="border-t border-slate-100">
            <td className="px-3 py-1.5">{s.type}</td>
            <td className="px-3 py-1.5 font-mono">{s.start === s.end ? s.start : `${s.start}–${s.end}`}</td>
            <td className="px-3 py-1.5">
              {s.ligand ?? s.description ?? "—"}
              {s.ligand && s.description && <span className="text-slate-500"> · {s.description}</span>}
            </td>
            <td className="px-3 py-1.5">
              <EvidenceBadge experimental={s.experimental} label={s.evidence_label} />
            </td>
            <td className="px-3 py-1.5">
              <References refs={s.references} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VariantsTable({ data, experimentalOnly }: { data: Annotation; experimentalOnly: boolean }) {
  const [all, setAll] = useState(false);
  const variants = data.variants.filter((v) => (all || v.functional) && (!experimentalOnly || v.experimental));
  return (
    <div>
      <label className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-slate-600">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Afficher aussi les variants naturels sans effet décrit ({data.variants.filter((v) => !v.functional).length})
      </label>
      {!variants.length ? (
        <Empty text="Aucun variant fonctionnel documenté." />
      ) : (
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className={th}>Changement</th>
              <th className={th}>Nature</th>
              <th className={th}>Effet décrit</th>
              <th className={th}>Preuve</th>
              <th className={th}>Références</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v, k) => (
              <tr key={k} className="border-t border-slate-100 align-top">
                <td className="px-3 py-1.5 font-mono font-semibold">{variantLabel(v)}</td>
                <td className="px-3 py-1.5">
                  {v.kind}
                  {v.disease && <span className="ml-1 rounded bg-rose-50 px-1 text-[11px] font-semibold text-rose-700">maladie</span>}
                  {v.dbsnp && (
                    <a href={`https://www.ncbi.nlm.nih.gov/snp/${v.dbsnp}`} target="_blank" rel="noreferrer" className="ml-1 font-mono text-[11px] text-blue-700 hover:underline">
                      {v.dbsnp}
                    </a>
                  )}
                </td>
                <td className="max-w-[420px] px-3 py-1.5 text-slate-700">{v.description ?? "—"}</td>
                <td className="px-3 py-1.5">
                  <EvidenceBadge experimental={v.experimental} label={v.evidence_label} />
                </td>
                <td className="px-3 py-1.5">
                  <References refs={v.references} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="px-3 py-2 text-[12px] text-slate-500">
        Mutagenèse dirigée : substitution introduite expérimentalement pour tester un rôle. Variant naturel : polymorphisme ou mutation
        observés, avec l’effet ou la maladie associés quand UniProt les documente.
      </p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-3 text-[14px] text-slate-500">{text}</p>;
}
