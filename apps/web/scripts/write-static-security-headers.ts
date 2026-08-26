import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { securityHeaders } from "../security-policy.ts";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(dirname, "../public/_headers");
const lines = ["/*", ...Object.entries(securityHeaders).map(([name, value]) => `  ${name}: ${value}`), "", "/sw.js", "  Cache-Control: no-cache, no-store, must-revalidate"];
fs.writeFileSync(output, `${lines.join("\n")}\n`);
console.log(`STATIC_SECURITY_HEADERS=${output}`);
