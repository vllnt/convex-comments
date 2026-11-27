import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guards the release pipeline in .github/workflows/publish.yml: npm trusted
// publishing only, stable only from a vX.Y.Z tag that matches package.json and a
// CHANGELOG.md entry, canary only from main, and the package checks in the
// `quality` job that both publish jobs depend on.

const workflow = readFileSync(".github/workflows/publish.yml", "utf8");
const packageText = readFileSync("package.json", "utf8");

/** @param {string} name @returns {string} the job's block, up to the next job */
function job(name) {
  const match = new RegExp(
    `^  ${name}:\\n((?:    .*\\n|\\s*\\n)*)`,
    "mu",
  ).exec(workflow);
  assert.ok(match, `publish.yml has no \`${name}\` job`);
  return match[1];
}

const quality = job("quality");
const steps = [...quality.matchAll(/^\s+- run: (.+)$/gmu)].map((m) => m[1]);
const at = (command) => steps.indexOf(command);
for (const command of [
  "pnpm test:coverage",
  "pnpm build",
  "pnpm test:package",
]) {
  assert.notEqual(at(command), -1, `quality job must run \`${command}\``);
}
assert.ok(
  at("pnpm build") < at("pnpm test:package"),
  "quality job must run `pnpm test:package` after `pnpm build`",
);

for (const name of ["canary", "release"]) {
  assert.match(
    job(name),
    /^    needs: quality$/mu,
    `${name} job must depend on quality`,
  );
}

assert.match(workflow, /tags: \["v\*\.\*\.\*"\]/u, "tag trigger v*.*.*");
assert.match(
  job("canary"),
  /^    if: github\.ref == 'refs\/heads\/main'$/mu,
  "canary only on refs/heads/main",
);
assert.match(
  job("release"),
  /^    if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/mu,
  "release only on a v tag",
);
assert.equal(
  workflow.match(/npm publish [^\n]*--provenance/gu)?.length,
  2,
  "both npm publish commands use --provenance",
);
assert.match(workflow, /cancel-in-progress: false/u);
assert.doesNotMatch(workflow, /NPM_TOKEN|_authToken\s*=/u, "no npm token");

const release = job("release");
for (const [pattern, fact] of [
  [/\[ "\$TAG" = "v\$VERSION" \]/u, "tag matches package.json version"],
  [/merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/u, "tag is on main"],
  [/grep -qF "## \[\$VERSION\]" CHANGELOG\.md/u, "CHANGELOG has the entry"],
]) {
  assert.match(release, pattern, `release tag check: ${fact}`);
}
assert.ok(
  release.indexOf("Verify release tag") < release.indexOf("npm publish"),
  "release tag check runs before npm publish",
);

const scripts = JSON.parse(packageText).scripts;
assert.match(
  scripts["test:coverage"],
  /^pnpm typecheck:tests && /u,
  "test:coverage must type-check the tests first",
);
assert.doesNotMatch(
  packageText,
  /"(?:release|prepublishOnly|prepublish)"\s*:|npm publish/u,
  "package.json must not publish locally",
);

console.log("OK    release pipeline guards");
