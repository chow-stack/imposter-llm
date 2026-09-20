import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relative, join, basename } from "node:path";

const root = process.cwd();
const excludedDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".vercel",
  ".temp",
  ".branches",
  "test-results",
  "playwright-report",
]);
const privateFile = (name) =>
  name === ".env" ||
  (name.startsWith(".env.") && name !== ".env.example") ||
  /\.(local|pem|key|p12|pfx|log)$/.test(name) ||
  name === ".npmrc";
const findings = [];
let files;
try {
  // Include tracked files even if a later .gitignore change would hide them.
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split("\0")
    .filter(Boolean);
  for (const file of tracked)
    if (
      privateFile(basename(file)) ||
      file.split("/").some((x) => excludedDirs.has(x))
    )
      findings.push(`${file}: private/generated file is tracked by Git`);
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  )
    .split("\0")
    .filter(Boolean);
  files = [...new Set([...tracked, ...untracked])];
} catch {
  function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory())
        return excludedDirs.has(entry.name) ? [] : walk(path);
      return privateFile(entry.name) || entry.name.endsWith(".tsbuildinfo")
        ? []
        : [relative(root, path)];
    });
  }
  files = walk(root);
}
const patterns = [
  ["Supabase key", /sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/],
  ["Supabase access token", /sbp_[a-f0-9]{30,}/i],
  [
    "JWT token",
    /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/,
  ],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "GitHub token",
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,
  ],
  ["API secret", /sk-(?:proj-)?[A-Za-z0-9_-]{24,}/],
  ["AWS access key", /AKIA[A-Z0-9]{16}/],
  ["database credentials", /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i],
];
for (const file of files) {
  let content;
  try {
    content = readFileSync(join(root, file), "utf8");
  } catch {
    continue;
  }
  for (const [kind, pattern] of patterns)
    if (pattern.test(content)) findings.push(`${file}: possible ${kind}`);
}
if (findings.length) {
  console.error(
    "Secret check failed (values withheld):\n" + findings.join("\n"),
  );
  process.exit(1);
}
console.log(
  `Secret check passed: ${files.length} source/config files scanned; no matching credentials. Local environment and build output stay excluded.`,
);
