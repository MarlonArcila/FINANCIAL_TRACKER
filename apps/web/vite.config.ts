import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(dirname, "../..");

export default defineConfig({
  // CapitalFlow guarda los archivos .env en la raíz del monorepo.
  // apps/web utiliza esa misma configuración.
  envDir: repositoryRoot,

  plugins: [react()],

  resolve: {
    alias: {
      "@capitalflow/core": path.resolve(
        dirname,
        "../../packages/core/src/index.ts",
      ),
    },
  },

  // Solo se utiliza durante desarrollo local.
  server: {
    port: 5173,
    host: "localhost",
    strictPort: true,
  },

  // Solo se utiliza para probar localmente el build de producción.
  preview: {
    port: 4173,
    host: "localhost",
    strictPort: true,
  },

  build: {
    target: "es2022",

    // No publicar el código fuente mediante source maps.
    // Si posteriormente usamos Sentry u otra plataforma
    // podremos cambiarlo por "hidden".
    sourcemap: false,
  },
});
