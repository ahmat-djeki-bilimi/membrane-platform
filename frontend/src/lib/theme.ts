// Classes complètes (Tailwind ne détecte pas les classes construites dynamiquement)
export const TONES = {
  blue: {
    bar: "bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-400",
    badge: "bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30",
    soft: "bg-blue-50/80 text-blue-800 border-blue-200/70",
    text: "text-blue-700",
  },
  emerald: {
    bar: "bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-400",
    badge: "bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-md shadow-emerald-500/30",
    soft: "bg-emerald-50/80 text-emerald-800 border-emerald-200/70",
    text: "text-emerald-700",
  },
  violet: {
    bar: "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-400",
    badge: "bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-500/30",
    soft: "bg-violet-50/80 text-violet-800 border-violet-200/70",
    text: "text-violet-700",
  },
  amber: {
    bar: "bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400",
    badge: "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30",
    soft: "bg-amber-50/80 text-amber-900 border-amber-200/70",
    text: "text-amber-700",
  },
  rose: {
    bar: "bg-gradient-to-r from-rose-500 via-pink-500 to-rose-400",
    badge: "bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-md shadow-rose-500/30",
    soft: "bg-rose-50/80 text-rose-800 border-rose-200/70",
    text: "text-rose-700",
  },
  cyan: {
    bar: "bg-gradient-to-r from-cyan-400 via-sky-500 to-cyan-400",
    badge: "bg-gradient-to-br from-cyan-400 to-sky-600 text-white shadow-md shadow-cyan-500/30",
    soft: "bg-cyan-50/80 text-cyan-900 border-cyan-200/70",
    text: "text-cyan-700",
  },
  slate: {
    bar: "bg-gradient-to-r from-slate-300 via-slate-400 to-slate-300",
    badge: "bg-gradient-to-br from-slate-500 to-slate-700 text-white shadow-md shadow-slate-500/20",
    soft: "bg-slate-50 text-slate-700 border-slate-200",
    text: "text-slate-600",
  },
} as const;

export type Tone = keyof typeof TONES;

// Bandeau principal partagé par toutes les pages : nuit indigo, violet, touche cyan
export const HERO_BG =
  "relative isolate overflow-x-clip bg-[linear-gradient(125deg,#0f0c29_0%,#1e1b4b_30%,#3b2a8c_62%,#0e5a7a_100%)]";
// Halos « aurore » + grille estompée (à poser en premier enfant du bandeau)
export const HERO_GLOW =
  "pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_88%_12%,rgba(34,211,238,0.30),transparent_38%),radial-gradient(circle_at_12%_100%,rgba(217,70,239,0.28),transparent_42%),radial-gradient(circle_at_55%_-10%,rgba(129,140,248,0.35),transparent_45%)] after:absolute after:inset-0 after:bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] after:bg-[size:44px_44px] after:[mask-image:radial-gradient(ellipse_at_60%_20%,#000_15%,transparent_70%)] after:content-['']";
