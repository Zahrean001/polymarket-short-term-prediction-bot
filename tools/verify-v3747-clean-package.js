import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  excludedDirectories,
  normalized,
  shouldExcludeDirectory,
  shouldExcludeFile,
} from "./source-package-rules.js";

const root = process.cwd();
let ok = true;
function pass(message) { console.log(`PASS ${message}`); }
function fail(message) { ok = false; console.error(`FAIL ${message}`); }
function exists(relative) { return fs.existsSync(path.join(root, relative)); }
function digest(relative) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
}

const required = [
  "server/index.js",
  "server/market/orderBookState.js",
  "server/market/rtdsPriceMessage.js",
  "server/market/externalPriceFeedLiveness.js",
  "server/execution/paperFill.js",
  "server/execution/fastGrowFillReconciler.js",
  "server/execution/equityCompoundingPolicy.js",
  "server/execution/candidateValidity.js",
  "server/execution/paperCommitPolicy.js",
  "server/execution/marketMinimumStake.js",
  "server/prediction/independentDigitalModel.js",
  "server/prediction/calibratedNetEvPolicy.js",
  "server/prediction/independentAssetEdgePolicy.js",
  "server/prediction/eligibilityEpisode.js",
  "server/prediction/fastGrowEvPolicy.js",
  "server/prediction/frozenCalibrationProfile.js",
  "server/prediction/mainAccuracyLane.js",
  "server/prediction/regimeCorePolicy.js",
  "server/risk/cohortRegimeGuard.js",
  "server/research/observerPolicy.js",
  "server/research/antiDowngradeEvidence.js",
  "server/research/directionOnlyShadow.js",
  "server/research/shadowIsolation.js",
  "server/storage/predictionPersistence.js",
  "server/metrics/officialTradeMetrics.js",
  "server/metrics/primaryPaperSignal.js",
  "tests/v3744-eligibility-episode.test.js",
  "tests/v3744-asset-book-separation.test.js",
  "tests/v3744-book-economic-revision.test.js",
  "tests/v3744-external-price-watchdog.test.js",
  "tests/v3744-v3743-policy-replay.test.js",
  "tests/v3745-exact-market-minimum.test.js",
  "tests/v3745-regime-core.test.js",
  "tests/v3745-cohort-regime-guard.test.js",
  "tests/v3745-observer-policy.test.js",
  "tests/v3746-anti-downgrade-evidence.test.js",
  "tests/v3746-persistence-and-audit.test.js",
  "tests/v3747-direction-only-shadow.test.js",
  "tools/run-unit-tests.js",
  "tools/verify-v3747-frozen-core.js",
  "tools/verify-v3747-observer-runtime-smoke.js",
  "tools/verify-v3747-runtime-smoke.js",
  "tools/verify-v3747-config-semantics.js",
  "tools/verify-v3747-syntax.js",
  "V3745_FROZEN_CORE.sha256",
  "V3747_BASELINE_EVIDENCE.json",
  "V3747_IMPLEMENTATION_PLAN.md",
  "V3747_VERIFICATION_REPORT.md",
  "INSTALL_V3747_PAPER.md",
  "FORWARD_VALIDATION_PROTOCOL_V3747.md",
  "ecosystem.config.cjs",
  "package.json",
  "package-lock.json",
  "MANIFEST.sha256",
];
for (const relative of required) exists(relative) ? pass(`required present ${relative}`) : fail(`required missing ${relative}`);

const forbiddenNames = new Set([".env", "id_rsa", "id_ed25519", "wallet.json", "credentials.json"]);
const forbiddenRuntimeNames = /(?:^|\/)(?:dist|build|node_modules|\.git|evidence|signals|decisions|settlements|backups)(?:\/|$)/i;
const forbiddenFilePattern = /\.(?:log|bak|zip|tar|tgz|gz|sqlite|sqlite3|db)$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:PRIVATE_KEY|POLYMARKET_PRIVATE_KEY)\s*=\s*(?!$|changeme|your_)/i,
  /(?:VPS_PASSWORD|WALLET_SEED|MNEMONIC)\s*=\s*\S+/i,
];
const textExtensions = new Set([".js", ".cjs", ".mjs", ".jsx", ".json", ".md", ".txt", ".html", ".css", ".sh", ".example"]);
const packagedFiles = [];
let sourceBytes = 0;

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    const relativeOs = path.relative(root, resolved);
    const relative = normalized(relativeOs);
    if (entry.isDirectory()) {
      if (!shouldExcludeDirectory(relativeOs)) walk(resolved);
      continue;
    }
    if (!entry.isFile() || shouldExcludeFile(relativeOs)) continue;
    packagedFiles.push(relative);
    const stat = fs.statSync(resolved);
    sourceBytes += stat.size;
    if (forbiddenRuntimeNames.test(relative)) fail(`forbidden runtime path in source payload: ${relative}`);
    if (forbiddenFilePattern.test(relative)) fail(`forbidden runtime/archive file in source payload: ${relative}`);
    if (forbiddenNames.has(entry.name)) fail(`forbidden secret filename: ${relative}`);
    if (stat.size > 5_000_000) fail(`single source file exceeds 5MB: ${relative}`);
    if (textExtensions.has(path.extname(entry.name).toLowerCase()) || entry.name === ".env.example") {
      const text = fs.readFileSync(resolved, "utf8");
      for (const pattern of secretPatterns) if (pattern.test(text)) fail(`possible secret material: ${relative}`);
    }
  }
}
walk(root);

if (sourceBytes >= 5_000_000) fail(`uncompressed source payload must stay below 5MB: ${sourceBytes}`);
else pass(`source payload size ${sourceBytes} bytes (<5MB)`);

if (exists("MANIFEST.sha256")) {
  const rows = fs.readFileSync(path.join(root, "MANIFEST.sha256"), "utf8").trim().split("\n").filter(Boolean);
  const manifest = new Map();
  for (const row of rows) {
    const match = row.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) { fail(`invalid manifest row: ${row}`); continue; }
    manifest.set(match[2], match[1]);
  }
  const expected = [...packagedFiles].sort((a, b) => a.localeCompare(b));
  const listed = [...manifest.keys()].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(expected) !== JSON.stringify(listed)) fail("manifest file list does not match source-only payload");
  for (const relative of expected) if (manifest.get(relative) !== digest(relative)) fail(`manifest hash mismatch: ${relative}`);
  if (ok) pass(`manifest covers ${expected.length} source-only files`);
}

if (!excludedDirectories.has("dist") || !excludedDirectories.has("node_modules") || !excludedDirectories.has("evidence")) {
  fail("manifest exclusion contract incomplete");
}
if (exists("src/App.jsx") && /Math\.random\s*\(/.test(fs.readFileSync(path.join(root, "src/App.jsx"), "utf8"))) {
  fail("UI must not fabricate scanner/event telemetry with random data");
}
if (/RealExecutor|\.placeOrder\s*\(/.test(fs.readFileSync(path.join(root, "server/index.js"), "utf8"))) {
  fail("real order execution path present");
}
if (/Math\.max\(\s*3\s*,\s*MIN_EXECUTABLE_STAKE_USD/.test(fs.readFileSync(path.join(root, "server/index.js"), "utf8"))) {
  fail("legacy fixed three-dollar execution floor present");
}

if (!ok) {
  console.error("V374.7 direction-only shadow source-only clean-package verifier FAILED");
  process.exit(1);
}
console.log("V374.7 direction-only shadow source-only clean-package verifier PASSED");
