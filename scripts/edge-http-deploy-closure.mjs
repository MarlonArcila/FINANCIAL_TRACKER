import fs from "node:fs";
import path from "node:path";

const root = path.resolve("supabase/functions");
const target = path.join(root, "_shared", "http.ts");
const importPattern = /(?:from\s+|import\s*)["'](\.[^"']+)["']/gu;

function dependencies(file) {
  const source = fs.readFileSync(file, "utf8");
  const result = [];
  for (const match of source.matchAll(importPattern)) {
    const raw = match[1];
    const candidate = path.resolve(path.dirname(file), raw);
    for (const resolved of [candidate, `${candidate}.ts`, `${candidate}.tsx`, path.join(candidate, "index.ts")]) {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) { result.push(resolved); break; }
    }
  }
  return result;
}

function reachesTarget(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const current = stack.pop();
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    if (!current.startsWith(root) || !fs.existsSync(current)) continue;
    for (const dep of dependencies(current)) stack.push(dep);
  }
  return false;
}

const slugs = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .filter((slug) => {
    const index = path.join(root, slug, "index.ts");
    return fs.existsSync(index) && reachesTarget(index);
  })
  .sort();

for (const slug of slugs) console.log(slug);
