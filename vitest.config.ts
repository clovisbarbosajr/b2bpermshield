import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // `supabase/functions` ENTROU em 28/ago/2026. Ate aqui o include era so
    // `src/**`, entao TODO teste escrito ao lado de uma edge function era ignorado
    // pelo `npm test` — o arquivo existia, ninguem rodava, e a suite passava verde
    // dizendo que estava tudo testado. Teste que nao roda e pior que teste
    // nenhum: ele afirma cobertura que nao existe.
    //
    // As edge functions rodam com SERVICE ROLE e ignoram RLS, entao sao
    // justamente o codigo onde uma guarda que sumiu nao encontra nenhuma outra
    // barreira depois.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.{ts,tsx}",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
