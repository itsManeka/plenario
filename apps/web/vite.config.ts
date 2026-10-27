import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Em dev e no preview, /api/* vai para a API local (apps/api, porta 8787) sem o prefixo.
// Com VITE_MOCK=1 o cliente nem chega a fazer fetch: responde com fixtures (src/api/mock).
const proxy = {
  "/api": {
    target: "http://localhost:8787",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
