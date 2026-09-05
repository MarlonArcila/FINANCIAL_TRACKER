import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const sharedDir = "supabase/functions/_shared";
const denoOnlyTests = new Set(["email-relay.test.ts"]);
const allTests = readdirSync(sharedDir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

for (const name of denoOnlyTests) {
  if (!allTests.includes(name)) {
    console.error(`Expected Deno-only test is missing: ${name}`);
    process.exit(1);
  }
}

const nodeTests = allTests
  .filter((name) => !denoOnlyTests.has(name))
  .map((name) => join(sharedDir, name));

if (nodeTests.length === 0) {
  console.error("No Node-compatible Edge tests discovered.");
  process.exit(1);
}

console.log(`Node Edge tests: ${nodeTests.length}; Deno-only tests excluded here: ${[...denoOnlyTests].join(", ")}`);
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...nodeTests],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
