import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image Docker autonome et légère (dossier .next/standalone)
  output: "standalone",
  // Dossier de compilation configurable : une vérification de build ne doit pas
  // écraser le dossier .next utilisé par le serveur de développement
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
