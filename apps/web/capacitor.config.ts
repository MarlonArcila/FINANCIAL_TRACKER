import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.capitalflow",
  appName: "CapitalFlow",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
