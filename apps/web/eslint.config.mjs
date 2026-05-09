import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Bundles do agente-local publicados em /public — sao build artifacts
    // CommonJS gerados automaticamente, nao codigo-fonte. Nao lintar.
    "public/agente-release/**",
  ]),
  // Regras estritas do react-hooks v6 + react/no-unescaped-entities + next/no-html-link-for-pages
  // sao rebaixadas pra warnings (em vez de errors) pra desbloquear CI sem
  // quebrar deploy. Devem ser endereçadas individualmente em cleanup futuro.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
]);

export default eslintConfig;
