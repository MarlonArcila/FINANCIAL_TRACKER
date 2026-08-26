import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const functionsRoot = join(root, "supabase", "functions");
const violations = [];

function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(path);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    if (/\.schema\(\s*["']private["']\s*\)/u.test(source)) {
      violations.push(relative(root, path));
    }
  }
}

visit(functionsRoot);

const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
const schemasLine = config.match(/^schemas\s*=\s*\[(.*)\]\s*$/mu)?.[1] ?? "";
if (/(["'])private\1/u.test(schemasLine)) {
  violations.push("supabase/config.toml exposes private schema");
}

if (violations.length) {
  console.error("PRIVATE_DATA_API_BOUNDARY=FAIL");
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log("PRIVATE_DATA_API_BOUNDARY=GREEN");
