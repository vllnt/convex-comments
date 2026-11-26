import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

// Fails when the npm tarball is missing a required doc, ships a file outside the
// allowlist, or llms.txt links to a shipped file in a way that is not version-matched.
// Run `pnpm build` first so `dist/` is part of the pack.

const DOCS = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
];
const GITHUB_MAIN = "https://github.com/vllnt/convex-comments/blob/main/";

const output = execFileSync(
  "npm",
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const packed = new Set(JSON.parse(output)[0].files.map((file) => file.path));

const problems = [];
for (const path of DOCS) {
  if (!packed.has(path)) problems.push(`missing from tarball: ${path}`);
}
for (const path of packed) {
  const allowed =
    DOCS.includes(path) ||
    path.startsWith("dist/") ||
    (path.startsWith("src/") && !/\.(test|spec)\./.test(path));
  if (!allowed) problems.push(`must not ship: ${path}`);
}

const index = readFileSync("llms.txt", "utf8");
for (const [, target] of index.matchAll(/\]\(([^)]+)\)/g)) {
  if (target.startsWith(GITHUB_MAIN)) {
    const path = target.slice(GITHUB_MAIN.length);
    if (packed.has(path))
      problems.push(
        `llms.txt links shipped ${path} via GitHub main; use ./${path}`,
      );
  } else if (!/^(?:https?:|#)/.test(target)) {
    const path = target.split("#")[0].replace(/^\.\//, "");
    if (!packed.has(path))
      problems.push(
        `llms.txt link does not resolve inside the tarball: ${target}`,
      );
  }
}

if (problems.length > 0) {
  console.error(
    `FAIL package contents:\n${problems.map((p) => `  ${p}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `OK    package contents: ${packed.size} files, docs and llms.txt links resolve`,
  );
}
