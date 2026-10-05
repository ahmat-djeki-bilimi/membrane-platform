// Classes complètes (Tailwind ne détecte pas les classes construites dynamiquement)
export const TONES = {
  blue: {
    bar: "bg-blue-600",
    badge: "bg-blue-600 text-white",
    soft: "bg-blue-50 text-blue-700",
    text: "text-blue-700",
  },
  emerald: {
    bar: "bg-emerald-500",
    badge: "bg-emerald-500 text-white",
    soft: "bg-emerald-50 text-emerald-700",
    text: "text-emerald-700",
  },
  violet: {
    bar: "bg-violet-600",
    badge: "bg-violet-600 text-white",
    soft: "bg-violet-50 text-violet-700",
    text: "text-violet-700",
  },
  amber: {
    bar: "bg-amber-500",
    badge: "bg-amber-500 text-white",
    soft: "bg-amber-50 text-amber-700",
    text: "text-amber-700",
  },
  rose: {
    bar: "bg-rose-500",
    badge: "bg-rose-500 text-white",
    soft: "bg-rose-50 text-rose-700",
    text: "text-rose-700",
  },
  cyan: {
    bar: "bg-cyan-500",
    badge: "bg-cyan-500 text-white",
    soft: "bg-cyan-50 text-cyan-700",
    text: "text-cyan-700",
  },
  slate: {
    bar: "bg-slate-400",
    badge: "bg-slate-500 text-white",
    soft: "bg-slate-100 text-slate-700",
    text: "text-slate-700",
  },
} as const;

export type Tone = keyof typeof TONES;

// Dégradé du bandeau principal, partagé par toutes les pages
export const HERO_BG =
  "relative bg-[linear-gradient(120deg,#0b2545_0%,#0f4c81_55%,#0e7490_100%)]";
export const HERO_GLOW =
  "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(34,211,238,0.25),transparent_45%),radial-gradient(circle_at_10%_90%,rgba(16,185,129,0.18),transparent_40%)]";
