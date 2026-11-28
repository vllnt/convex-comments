// Shared by `pnpm test:package` and `pnpm check:docs`: pack the built package,
// install the tarball in a temporary consumer project, type-check files there.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";

/** Version of a dev dependency as installed in this repository. @param {string} name */
export const locked = (name) =>
  `${name}@${String(JSON.parse(readFileSync(join("node_modules", name, "package.json"), "utf8")).version)}`;

/** @param {string} command @param {string[]} args @param {string} cwd */
export const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });

/**
 * Packs this package, installs the tarball and `dependencies` in a new temporary
 * project, calls `check(consumer, installed)`, and removes the project afterwards.
 * @template T
 * @param {string} prefix temporary directory name prefix
 * @param {string[]} dependencies extra `pnpm add` specifiers
 * @param {(consumer: string, installed: string) => T} check
 * @returns {T}
 */
export function withConsumer(prefix, dependencies, check) {
  const root = process.cwd();
  /** @type {{ name: string, version: string }} */
  const metadata = JSON.parse(readFileSync("package.json", "utf8"));
  const tarball = `${metadata.name.replace("@", "").replace("/", "-")}-${metadata.version}.tgz`;
  const consumer = mkdtempSync(join(tmpdir(), prefix));
  try {
    run("pnpm", ["pack", "--pack-destination", consumer], root);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        pnpm: { ignoredBuiltDependencies: ["esbuild"] },
        private: true,
        type: "module",
      }),
    );
    // No lockfile here, so pnpm picks transitive versions itself. The temp project
    // lives outside the repo, so copy the repo's workspace file to keep the same
    // minimumReleaseAge and minimumReleaseAgeExclude, then add the build policy.
    writeFileSync(
      join(consumer, "pnpm-workspace.yaml"),
      `${readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")}allowBuilds:\n  esbuild: false\n`,
    );
    run(
      "pnpm",
      ["add", "--prefer-offline", join(consumer, tarball), ...dependencies],
      consumer,
    );
    return check(consumer, join(consumer, "node_modules", metadata.name));
  } finally {
    rmSync(consumer, { force: true, recursive: true });
  }
}

/**
 * Type-checks files with the repository's TypeScript, resolving modules and
 * `types` from the consumer; throws on any error.
 * @param {string} consumer @param {string[]} files @param {ts.CompilerOptions} options
 */
export function typecheck(consumer, files, options) {
  const compilerHost = ts.createCompilerHost(options);
  compilerHost.getCurrentDirectory = () => consumer;
  const program = ts.createProgram(
    files.map((file) => join(consumer, file)),
    options,
    compilerHost,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const host = {
    getCanonicalFileName: (/** @type {string} */ file) => file,
    getCurrentDirectory: () => consumer,
    getNewLine: () => "\n",
  };
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, host) || "consumer files type-check",
  );
}
