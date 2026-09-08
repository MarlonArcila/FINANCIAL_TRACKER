import { readFileSync } from "node:fs";

const session = readFileSync(new URL("../apps/web/src/hooks/useSession.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../apps/web/src/App.tsx", import.meta.url), "utf8");

const assertions = [
  [session.includes("error: string | null;"), "session controller exposes a safe bootstrap error"],
  [session.includes("SESSION_BOOTSTRAP_TIMEOUT_MS = 10_000"), "session bootstrap has a bounded timeout"],
  [session.includes("const client = supabase;"), "bootstrap captures a stable non-null Supabase client"],
  [session.includes("if (!client) {"), "missing Supabase configuration is handled explicitly"],
  [session.includes("setError(SESSION_CONFIGURATION_ERROR);"), "missing configuration surfaces a safe error"],
  [session.includes("Promise.race([sessionPromise, timeoutPromise])"), "getSession races a timeout"],
  [session.includes("setError(SESSION_BOOTSTRAP_ERROR);"), "bootstrap failures surface a safe error"],
  [session.includes("setLoading(false);"), "terminal bootstrap paths can end loading"],
  [!/onAuthStateChange\s*\(\s*async\b/.test(session), "onAuthStateChange callback does not perform async Supabase API work"],
  [app.includes("if (session.error)"), "App renders bootstrap errors before AuthPage"],
  [app.includes("No se pudo iniciar CapitalFlow"), "App renders a clear startup error"],
  [app.includes("window.location.reload()"), "startup error provides a retry path"],
  [app.includes("Reintentar"), "startup retry action is visible"],
  [!app.includes("VITE_SUPABASE_"), "startup UI does not expose environment variable names"],
];

for (const [ok, message] of assertions) {
  if (!ok) throw new Error(`WEB_BOOTSTRAP_INVARIANT_FAILED: ${message}`);
}
console.log("WEB_BOOTSTRAP_INVARIANT=PASS");
