import type { CapacitorConfig } from "@capacitor/cli";

const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
const appId = runtime.process?.env?.CAPACITOR_APP_ID?.trim() || "com.example.capitalflow";

const config: CapacitorConfig = {
  appId,
  appName: "CapitalFlow",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
