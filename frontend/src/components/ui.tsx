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
    <section
      id={id}
      className="relative scroll-mt-16 overflow-hidden rounded-lg border border-slate-200 bg-white"
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${TONES[tone].bar}`} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`rounded-md p-2 shadow-sm ${TONES[tone].badge}`}>{icon}</span>
          <div>
            <p className={`text-[12px] font-semibold uppercase tracking-[0.14em] ${TONES[tone].text}`}>
              {label}
            </p>
            <h2 className="text-[17px] font-semibold text-slate-900">{title}</h2>
          </div>
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PanelLoading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-[14px] text-slate-500">
      <Loader2 size={15} className="animate-spin text-cyan-600" />
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
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-3">
      <span className={`absolute inset-x-0 top-0 h-1 ${TONES[tone].bar}`} />
      <div className="flex items-center gap-2">
        <span className={`rounded-md p-1.5 ${TONES[tone].badge}`}>{icon}</span>
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {label}
        </p>
      </div>
      {value === null ? (
        <div className="mt-2 h-6 w-24 animate-pulse rounded bg-slate-100" />
      ) : (
        <p className="mt-1.5 text-[22px] font-bold text-slate-900">{value}</p>
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
      className={`flex items-start gap-3 rounded-lg border border-slate-200 p-3 ${TONES[tone].soft}`}
    >
      <span className={`mt-0.5 shrink-0 rounded-md p-1.5 ${TONES[tone].badge}`}>
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
        <p className="text-[15px] font-semibold">{title}</p>
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
      className={`rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">
        {label}
      </dt>
      <dd
        className={`truncate text-[15px] font-medium text-slate-900 ${mono ? "font-mono" : ""} ${
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            value === o.value
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
