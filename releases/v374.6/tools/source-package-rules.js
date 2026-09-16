import path from "node:path";

const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "evidence",
  "signals",
  "decisions",
  "settlements",
  "backups",
]);
const excludedFilePatterns = [
  /(?:^|\/)V3743_VERIFICATION_REPORT\.md$/i,
  /\.(?:log|bak|zip|tar|tgz|gz|sqlite|sqlite3|db)$/i,
  /(?:^|\/)(?:btc-paper-state|position-ledger|paper-session-state|reference-wallet-state)\.json$/i,
  /\.sha256$/i,
];

function normalized(relative) {
  return relative.split(path.sep).join("/");
}

function shouldExcludeDirectory(relative) {
  const parts = normalized(relative).split("/");
  const name = parts.at(-1) || "";
  return excludedDirectories.has(name) || /^data-(?:main|observer)(?:-|$)/.test(name);
}

function shouldExcludeFile(relative) {
  const clean = normalized(relative);
  if (clean === "V3745_FROZEN_CORE.sha256") return false;
  return clean === "MANIFEST.sha256" || excludedFilePatterns.some((pattern) => pattern.test(clean));
}

export { excludedDirectories, excludedFilePatterns, normalized, shouldExcludeDirectory, shouldExcludeFile };
