import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const must = (ok, message) => {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
};

const pkg = JSON.parse(read("package.json"));
const vercel = JSON.parse(read("vercel.json"));
const agents = read("AGENTS.md");
const release = read("docs/RELEASE_CONTRACT.md");
const deployment = read("docs/DEPLOYMENT.md");
const handoff = read("docs/AI_BUILDER_HANDOFF.md");
const envExample = read(".env.example");
const envTs = read("apps/web/src/lib/env.ts");
const session = read("apps/web/src/hooks/useSession.ts");
const app = read("apps/web/src/App.tsx");
const integrations = read("apps/web/src/pages/IntegrationsPage.tsx");
const ci = read(".github/workflows/ci.yml");
const doctor = read("scripts/capitalflow-release-doctor.sh");

must(
  fs.existsSync("package-lock.json"),
  "lockfile exists for deterministic installs",
);
must(
  ci.includes("run: npm ci") && !ci.includes("run: npm install"),
  "CI uses npm ci instead of dependency-resolving npm install",
);
must(
  pkg.scripts?.["test:web-bootstrap"] ===
    "node scripts/assert-web-bootstrap-session.mjs",
  "web bootstrap invariant is repository-native",
);
must(
  pkg.scripts?.["test:execution-contract"] ===
    "node scripts/assert-execution-contract.mjs",
  "execution contract test is repository-native",
);
must(
  pkg.scripts?.["doctor:release"] ===
    "bash scripts/capitalflow-release-doctor.sh",
  "release doctor is repository-native",
);
must(
  pkg.scripts?.test?.includes("test:web-bootstrap") &&
    pkg.scripts?.test?.includes("test:execution-contract"),
  "baseline test suite enforces both new invariants",
);

must(
  agents.includes("docs/RELEASE_CONTRACT.md"),
  "AGENTS routes runtime/release decisions to the current contract",
);
must(
  agents.includes("automatic Email Relay"),
  "AGENTS identifies the active Email Relay Integrations surface",
);
must(
  deployment.includes("docs/RELEASE_CONTRACT.md"),
  "deployment docs point to the current runtime contract",
);
must(
  handoff.includes("docs/RELEASE_CONTRACT.md"),
  "AI builder handoff points to the current runtime contract",
);

must(
  release.includes("VERCEL_ORG_ID") && release.includes("VERCEL_PROJECT_ID"),
  "release contract requires explicit Vercel project targeting",
);
must(
  release.includes("vercel curl") && release.includes("protected preview"),
  "release contract requires protection-aware preview smoke",
);
must(
  release.includes("VITE_SUPABASE_PUBLISHABLE_KEY") &&
    release.includes("VITE_SUPABASE_ANON_KEY"),
  "release contract documents Supabase public-key priority and fallback",
);
must(
  release.includes("fresh isolated") && release.includes("allowlist"),
  "release contract rejects brittle transient-state repairs",
);

must(
  envExample.includes("VITE_SUPABASE_PUBLISHABLE_KEY="),
  "environment example uses the modern Supabase publishable key",
);
must(
  envTs.includes("VITE_SUPABASE_PUBLISHABLE_KEY") &&
    envTs.includes("VITE_SUPABASE_ANON_KEY"),
  "web runtime prefers publishable key and retains anon fallback",
);
must(
  !envTs.includes("VITE_SUPABASE_SERVICE_ROLE") &&
    !envTs.includes("VITE_SUPABASE_SECRET_KEY"),
  "web environment never requests privileged Supabase credentials",
);

must(
  session.includes("SESSION_BOOTSTRAP_TIMEOUT_MS = 10_000"),
  "session bootstrap is bounded to ten seconds",
);
must(
  session.includes("Promise.race([sessionPromise, timeoutPromise])"),
  "getSession is explicitly bounded by a timeout race",
);
must(
  session.includes("const client = supabase;"),
  "session bootstrap captures a stable Supabase client after null check",
);
must(
  !/onAuthStateChange\s*\(\s*async\b/.test(session),
  "onAuthStateChange callback does not perform async Supabase API work",
);
must(
  app.includes("if (session.error)") &&
    app.includes("Reintentar") &&
    app.includes("window.location.reload()"),
  "App renders a recoverable startup failure instead of an infinite spinner",
);
must(
  integrations.includes("import { EmailRelayCard }") &&
    integrations.includes("<EmailRelayCard />") &&
    !integrations.includes("GmailOAuth") &&
    !integrations.includes("AndroidIntegration") &&
    !integrations.includes("NotificationIntegration"),
  "Integrations surface remains Email Relay only",
);
const appShell = read("apps/web/src/components/AppShell.tsx");
const relayCard = read("apps/web/src/components/EmailRelayCard.tsx");
must(
  appShell.includes("Fuentes Financieras") &&
    integrations.includes("<h1>Fuentes Financieras</h1>") &&
    !integrations.includes("<h1>Integraciones</h1>"),
  "financial-sources terminology is visible without changing the internal route",
);
must(
  relayCard.includes("Configuración del reenvío") &&
    relayCard.includes("Filtros sugeridos para Gmail") &&
    relayCard.includes("Verificaciones de reenvío"),
  "financial-sources guide and verification inbox are present",
);
must(
  !relayCard.includes("style={"),
  "Email Relay controls use the shared visual system rather than inline styles",
);

must(
  vercel.installCommand === "npm ci",
  "Vercel install command is deterministic",
);
must(
  vercel.buildCommand === "npm run build",
  "Vercel invokes the repository-root build contract",
);
must(
  pkg.scripts?.build ===
    "npm run build -w @capitalflow/core && npm run build -w @capitalflow/web",
  "root build compiles the web dependency graph before the web workspace",
);
must(
  vercel.outputDirectory === "apps/web/dist",
  "Vercel publishes the intended monorepo output directory",
);
must(
  !/^\s*vercel\s+link\b/m.test(doctor),
  "release doctor does not create Vercel project-link state",
);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const clientFiles = walk("apps/web/src").filter((p) =>
  /\.(?:ts|tsx|js|jsx)$/.test(p),
);
const privileged = clientFiles.filter((p) =>
  /SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_SERVICE_ROLE|VITE_SUPABASE_SECRET_KEY|sb_secret_/i.test(
    read(p),
  ),
);
must(
  privileged.length === 0,
  `browser source has no privileged Supabase key references${privileged.length ? `: ${privileged.join(", ")}` : ""}`,
);

if (process.exitCode) process.exit(process.exitCode);
