import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = ["server", "tools", "tests"];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(resolved);
    return entry.isFile() && resolved.endsWith(".js") ? [resolved] : [];
  });
}

let checked = 0;
const failures = [];
for (const filePath of roots.flatMap((directory) => walk(path.join(root, directory)))) {
  const source = fs.readFileSync(filePath, "utf8");
  const imports = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  for (const importPath of imports) {
    if (!importPath.startsWith(".")) continue;
    checked += 1;
    const resolved = path.resolve(path.dirname(filePath), importPath);
    const candidates = [resolved, `${resolved}.js`, `${resolved}.cjs`, `${resolved}.mjs`, `${resolved}.json`];
    if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
      failures.push(`${path.relative(root, filePath)} -> ${importPath}`);
    }
  }
}

if (failures.length) throw new Error(`unresolved_local_imports:\n${failures.join("\n")}`);
console.log(`Local import resolution PASSED (${checked} relative imports checked)`);
