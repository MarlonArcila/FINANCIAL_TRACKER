import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@capitalflow/core": path.resolve(dirname, "../../packages/core/src/index.ts"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
