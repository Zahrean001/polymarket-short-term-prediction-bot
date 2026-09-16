import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const lockPath = path.join(root, "V3745_FROZEN_CORE.sha256");
const rows = fs.readFileSync(lockPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
if (rows.length < 20) throw new Error(`v3747_frozen_core_lock_incomplete:${rows.length}`);

for (const row of rows) {
  const match = row.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error(`v3747_invalid_frozen_core_row:${row}`);
  const [, expected, relative] = match;
  const filePath = path.join(root, relative);
  if (!fs.existsSync(filePath)) throw new Error(`v3747_frozen_core_file_missing:${relative}`);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  if (actual !== expected) throw new Error(`v3747_unreviewed_main_core_change:${relative}:${actual}`);
}

console.log(`V374.7 frozen V374.5 execution-core verification PASSED (${rows.length}/${rows.length} files)`);
