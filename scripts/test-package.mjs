import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

// Fails when the npm tarball is missing a required doc or an `exports` target,
// ships a file outside the allowlist, or README.md / llms.txt link to a file that
// is not inside the tarball or link a shipped file through GitHub `main` (not
// version-matched). Run `pnpm build` first so `dist/` is part of the pack.

const DOCS = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
];
const LINKED = ["README.md", "llms.txt"];
const GITHUB_MAIN =
  /^https:\/\/github\.com\/vllnt\/convex-comments\/(?:blob|tree)\/main\/([^#]+)/;

const output = execFileSync(
  "npm",
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const packed = new Set(JSON.parse(output)[0].files.map((file) => file.path));
const metadata = JSON.parse(readFileSync("package.json", "utf8"));
const relative = (path) => path.split("#")[0].replace(/^\.\//, "");

/** @param {unknown} value @returns {string[]} */
const targets = (value) =>
  typeof value === "string"
    ? [value]
    : Object.values(value ?? {}).flatMap(targets);

const problems = [];
for (const path of DOCS) {
  if (!packed.has(path)) problems.push(`missing from tarball: ${path}`);
}
for (const target of targets([
  metadata.exports,
  metadata.types,
  metadata.module,
])) {
  if (!packed.has(relative(target)))
    problems.push(`exports target missing from tarball: ${target}`);
}
for (const path of packed) {
  const allowed =
    DOCS.includes(path) ||
    path.startsWith("dist/") ||
    (path.startsWith("src/") && !/\.(test|spec)\./.test(path));
  if (!allowed) problems.push(`must not ship: ${path}`);
}

for (const file of LINKED) {
  const text = readFileSync(file, "utf8");
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const github = GITHUB_MAIN.exec(target);
    if (github !== null) {
      if (packed.has(github[1]))
        problems.push(
          `${file} links shipped ${github[1]} via GitHub main; use ./${github[1]}`,
        );
    } else if (!/^(?:[a-z]+:|#)/.test(target)) {
      if (!packed.has(relative(target)))
        problems.push(
          `${file} link does not resolve inside the tarball: ${target}`,
        );
    }
  }
}

if (problems.length > 0) {
  console.error(
    `FAIL package contents:\n${problems.map((p) => `  ${p}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `OK    package contents: ${packed.size} files, docs, exports and links resolve`,
  );
}
