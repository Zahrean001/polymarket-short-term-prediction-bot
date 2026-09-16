import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const testDirectory = path.join(root, "tests");
const files = fs.readdirSync(testDirectory)
  .filter((name) => name.endsWith(".test.js"))
  .sort((left, right) => left.localeCompare(right));

let totalPassed = 0;
let totalFailed = 0;
let runnerFailed = false;

for (const name of files) {
  const relative = path.join("tests", name);
  const result = spawnSync(process.execPath, [relative], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  // Node 22 used "# pass"; newer Node releases render "ℹ pass".
  const passMatches = [...String(result.stdout || "").matchAll(/^(?:#\s*|ℹ\s*)pass\s+(\d+)\s*$/gmu)];
  const failMatches = [...String(result.stdout || "").matchAll(/^(?:#\s*|ℹ\s*)fail\s+(\d+)\s*$/gmu)];
  const passed = Number(passMatches.at(-1)?.[1] || 0);
  const failed = Number(failMatches.at(-1)?.[1] || 0);
  totalPassed += passed;
  totalFailed += failed;

  if (result.error || result.signal || result.status !== 0 || passMatches.length !== 1 || failMatches.length !== 1) {
    runnerFailed = true;
    console.error(`TEST FILE FAILED ${relative}: status=${result.status} signal=${result.signal || "none"} error=${result.error?.message || "none"}`);
  }
}

const total = totalPassed + totalFailed;
if (runnerFailed || totalFailed > 0 || total === 0) {
  console.error(`V374.6 sequential unit/regression verification FAILED (${totalPassed}/${total}, ${files.length} files)`);
  process.exit(1);
}
console.log(`V374.6 sequential unit/regression verification PASSED (${totalPassed}/${total}, ${files.length} files)`);
