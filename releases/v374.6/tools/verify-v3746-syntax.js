import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceFiles = [];
const jsonFiles = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", "build", "evidence", ".git", "signals", "decisions", "settlements", "backups"].includes(entry.name)) continue;
    if (/^data-(?:main|observer)(?:-|$)/.test(entry.name)) continue;
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(resolved);
    else if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) sourceFiles.push(resolved);
    else if (entry.isFile() && entry.name.endsWith(".json")) jsonFiles.push(resolved);
  }
}

walk(root);
for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`syntax_check_failed:${path.relative(root, file)}\n${result.stderr || result.stdout}`);
}
for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`json_parse_failed:${path.relative(root, file)}:${error.message}`);
  }
}

console.log(`V374.6 syntax verification PASSED (${sourceFiles.length} JS/CJS/MJS, ${jsonFiles.length} JSON)`);
