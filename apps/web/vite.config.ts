import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { metaContentSecurityPolicy, securityHeaders } from "./security-policy";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(dirname, "../..");

function productionSecurityMeta(): Plugin {
  return {
    name: "capitalflow-production-security-meta",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: metaContentSecurityPolicy },
          injectTo: "head-prepend",
        },
        {
          tag: "meta",
          attrs: { name: "referrer", content: "strict-origin-when-cross-origin" },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  envDir: repositoryRoot,
  plugins: [react(), productionSecurityMeta()],
  resolve: {
    alias: {
      "@capitalflow/core": path.resolve(dirname, "../../packages/core/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    host: "localhost",
    strictPort: true,
  },
  preview: {
    port: 4173,
    host: "localhost",
    strictPort: true,
    headers: securityHeaders,
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
