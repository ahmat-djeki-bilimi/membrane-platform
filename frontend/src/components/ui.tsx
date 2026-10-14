import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { TONES, type Tone } from "../lib/theme";

export function Panel({
  tone,
  icon,
  label,
  title,
  actions,
  children,
  id,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="card relative scroll-mt-20 overflow-hidden">
      <span className={`absolute inset-x-0 top-0 h-1 ${TONES[tone].bar}`} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-b from-slate-50/70 to-white px-5 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <span className={`rounded-xl p-2.5 ${TONES[tone].badge}`}>{icon}</span>
          <div>
            <p className={`text-[11.5px] font-bold uppercase tracking-[0.16em] ${TONES[tone].text}`}>
              {label}
            </p>
            <h2 className="text-[17px] font-bold tracking-tight text-slate-900">{title}</h2>
          </div>
        </div>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PanelLoading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 py-6 text-[14px] text-slate-500">
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/30" />
        <Loader2 size={15} className="animate-spin text-indigo-600" />
      </span>
      {text}
    </div>
  );
}

export function StatCard({
  tone,
  icon,
  label,
  value,
  hint,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: string | null;
  hint: string;
}) {
  return (
    <div className="card card-hover group relative overflow-hidden p-4">
      <span className={`absolute inset-x-0 top-0 h-1 ${TONES[tone].bar}`} />
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-[0.12] blur-xl transition group-hover:opacity-25 ${TONES[tone].bar}`}
      />
      <div className="flex items-center gap-2.5">
        <span className={`rounded-lg p-1.5 ${TONES[tone].badge}`}>{icon}</span>
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      </div>
      {value === null ? (
        <div className="mt-2.5 h-7 w-24 animate-pulse rounded-lg bg-slate-100" />
      ) : (
        <p className="mt-2 text-[24px] font-extrabold tracking-tight text-slate-900">{value}</p>
      )}
      <p className="truncate text-[13px] text-slate-500" title={hint}>
        {hint}
      </p>
    </div>
  );
}

export function Alert({
  tone,
  title,
  loading = false,
  children,
}: {
  tone: Tone;
  title: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "rose" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-2xl border p-3.5 ${TONES[tone].soft}`}
    >
      <span className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${TONES[tone].badge}`}>
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : tone === "rose" || tone === "amber" ? (
          <AlertTriangle size={14} />
        ) : tone === "emerald" ? (
          <CheckCircle2 size={14} />
        ) : (
          <Info size={14} />
        )}
      </span>
      <div>
        <p className="text-[15px] font-bold">{title}</p>
        <div className="text-[14px] leading-5 text-slate-700">{children}</div>
      </div>
    </div>
  );
}

export function InfoBox({
  label,
  value,
  mono = false,
  italic = false,
  wide = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  italic?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200/70 bg-gradient-to-br from-slate-50 to-indigo-50/40 px-3 py-2 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <dt className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</dt>
      <dd
        className={`truncate text-[15px] font-semibold text-slate-900 ${mono ? "font-mono" : ""} ${
          italic ? "italic" : ""
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-xl border border-slate-200/80 bg-slate-100/80 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            value === o.value
              ? "bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-100"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
