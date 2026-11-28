import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import ts from "typescript";

import { locked, run, typecheck, withConsumer } from "./package-consumer.mjs";

// Fails when the npm tarball is missing a required doc or an `exports` target,
// ships a file outside the allowlist, or README.md / llms.txt link to a file that
// is not inside the tarball or link a shipped file through GitHub `main` (not
// version-matched). Then installs the real tarball in a clean project, imports
// every runtime entry point under Node and type-checks a strict NodeNext consumer
// that imports every entry point. Run `pnpm build` first so `dist/` is packed.

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
  /^https:\/\/github\.com\/vllnt\/convex-comments\/(?:blob|tree)\/main\/([^#?]+)/;

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

// Install the tarball as a host would and use every entry point.
const entries = Object.keys(metadata.exports).filter(
  (key) => key !== "./package.json",
);
const specifier = (/** @type {string} */ key) =>
  `${metadata.name}${key.slice(1)}`;
try {
  withConsumer(
    "comments-package-",
    ["convex", "convex-test", "vite"].map(locked),
    (consumer) => {
      const runtime = entries.filter(
        (key) => typeof metadata.exports[key].default === "string",
      );
      run(
        "node",
        [
          "--input-type=module",
          "--eval",
          runtime.map((key) => `await import("${specifier(key)}");`).join("\n"),
        ],
        consumer,
      );
      writeFileSync(
        join(consumer, "consumer.ts"),
        [
          ...entries.map(
            (key, index) =>
              `import type * as e${String(index)} from "${specifier(key)}";`,
          ),
          `export type Entries = [${entries.map((_, index) => `typeof e${String(index)}`).join(", ")}];`,
        ].join("\n"),
      );
      typecheck(consumer, ["consumer.ts"], {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
      });
      console.log(
        `OK    installed package: ${String(runtime.length)} runtime entries import under Node; ${String(entries.length)} entries type-check (strict, NodeNext)`,
      );
    },
  );
} catch (error) {
  problems.push(
    `installed package check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
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
