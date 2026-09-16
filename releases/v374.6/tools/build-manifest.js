import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  normalized,
  shouldExcludeDirectory,
  shouldExcludeFile,
} from "./source-package-rules.js";

const root = process.cwd();

function walk(directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    const relative = path.relative(root, resolved);
    if (entry.isDirectory()) {
      if (!shouldExcludeDirectory(relative)) rows.push(...walk(resolved));
    } else if (entry.isFile() && !shouldExcludeFile(relative)) {
      rows.push(relative);
    }
  }
  return rows;
}

const files = walk(root).sort((left, right) => normalized(left).localeCompare(normalized(right)));
const lines = files.map((relative) => {
  const bytes = fs.readFileSync(path.join(root, relative));
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  return `${digest}  ${normalized(relative)}`;
});
fs.writeFileSync(path.join(root, "MANIFEST.sha256"), `${lines.join("\n")}\n`, "utf8");
console.log(`V374.6 source-only manifest generated (${files.length} files)`);
