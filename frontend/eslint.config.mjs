import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Le site remet ses données à zéro au début de chaque chargement
      // (setState puis fetch dans un effet) : schéma volontaire, signalé en
      // avertissement plutôt qu'en erreur.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compilation de contrôle (next build --dist-dir), ignorée par git
    ".next-check/**",
  ]),
]);

export default eslintConfig;
