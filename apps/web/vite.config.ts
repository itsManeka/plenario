import { copyFileSync, cpSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// Em dev e no preview, /api/* vai para a API local (apps/api, porta 8787) sem o prefixo.
// Com VITE_MOCK=1 o cliente nem chega a fazer fetch: responde com fixtures (src/api/mock).
// Com VITE_DADOS=estatico lê os JSON de <base>/data/ (gerados por apps/export em public/data).
const proxy = {
  "/api": {
    target: "http://localhost:8787",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

/**
 * Ajustes do dist depois do build.
 * - Site estático (GitHub Pages): copia index.html para 404.html. O Pages serve o 404.html em
 *   qualquer caminho que não é arquivo, então link direto e recarregar em /plenario/p/... sobem
 *   a SPA, e o React Router (com basename) resolve a rota. Alternativa seria o redirect via
 *   ?p= no 404.html, que muda a URL e precisa de script nos dois lados; a cópia é mais simples
 *   e o único custo é o status HTTP 404 nessas URLs (indiferente para o usuário).
 *   `.nojekyll` evita o processamento Jekyll do Pages.
 * - Modo API/mock: os dados do site estático (public/data, centenas de MB) não vão para o dist.
 *   O build não copia public/ sozinho (copyPublicDir: false); este plugin copia o resto.
 */
function ajustarDist(estatico: boolean): Plugin {
  let outDir = "dist";
  let publicDir = "public";
  return {
    name: "plenario-dist",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
      publicDir = c.publicDir;
    },
    closeBundle() {
      if (estatico) {
        copyFileSync(join(outDir, "index.html"), join(outDir, "404.html"));
        writeFileSync(join(outDir, ".nojekyll"), "");
        return;
      }
      for (const nome of readdirSync(publicDir)) {
        if (nome !== "data") cpSync(join(publicDir, nome), join(outDir, nome), { recursive: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const base = env.VITE_BASE || "/";
  const estatico = env.VITE_DADOS === "estatico";
  return {
    base: base.endsWith("/") ? base : `${base}/`,
    plugins: [react(), tailwindcss(), ajustarDist(estatico)],
    build: { copyPublicDir: estatico },
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
