// Publishes every publishable workspace whose local version is not yet on npm,
// in dependency order (a package goes out only after everything it declares).
//
// Idempotent on purpose: a package already serving its local version is skipped,
// so a run interrupted by a failed OTP or a network blip can simply be re-run.
// It stops at the first real failure rather than continuing past a missing
// dependency, because publishing out of order ships code that calls an export
// npm does not serve yet.
//
// npm publish asks for an OTP interactively, so this has to be run by a human
// in a terminal — it cannot complete inside an agent tool call.
//
//   node scripts/packages/publish-pending.mjs --dry-run   # show the plan
//   node scripts/packages/publish-pending.mjs             # publish
import { readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";

const REGISTRY = "https://registry.npmjs.org/";
const INTERNAL = /^(@mulmoclaude\/|@mulmobridge\/|mulmoclaude$)/;
const DEP_SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"];
const DRY_RUN = process.argv.includes("--dry-run");
const LAUNCHER = "mulmoclaude";

const manifestFiles = execSync("find . -name package.json -not -path '*/node_modules/*' -not -path './.git/*' -not -path './test/*'", {
  encoding: "utf8",
  maxBuffer: 1 << 26,
})
  .trim()
  .split("\n")
  .map((f) => f.replace(/^\.\//, ""));

const packages = new Map();
manifestFiles.forEach((file) => {
  const json = JSON.parse(readFileSync(file, "utf8"));
  if (!json.name || json.private || !INTERNAL.test(json.name)) return;
  packages.set(json.name, { name: json.name, version: json.version, dir: file.replace(/\/package\.json$/, ""), json });
});

const npmVersion = (name) => {
  try {
    return execSync(`npm view ${name} version --registry ${REGISTRY}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

// Depth-first over internal deps gives the bottom-up order: a package is
// appended only after everything it declares has been appended.
const order = [];
const done = new Set();
const visiting = new Set();
const visit = (name) => {
  if (done.has(name)) return;
  if (visiting.has(name)) throw new Error(`dependency cycle at ${name}`);
  visiting.add(name);
  const pkg = packages.get(name);
  DEP_SECTIONS.flatMap((s) => Object.keys(pkg.json[s] ?? {}))
    .filter((dep) => packages.has(dep) && dep !== name)
    .forEach(visit);
  visiting.delete(name);
  done.add(name);
  order.push(name);
};
[...packages.keys()].sort().forEach(visit);

const queue = [];
order.forEach((name) => {
  const pkg = packages.get(name);
  const live = npmVersion(name);
  if (live === pkg.version) return;
  if (name === LAUNCHER) {
    console.log(`SKIP  ${name} — the launcher ships through /publish-mulmoclaude, not this script`);
    return;
  }
  queue.push({ ...pkg, live });
});

console.log(`\n${queue.length} package(s) to publish, in this order:\n`);
queue.forEach((p, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${p.name.padEnd(34)} npm=${String(p.live ?? "(none)").padEnd(9)} -> ${p.version}`);
});

if (DRY_RUN) {
  console.log("\n--dry-run: nothing published");
  process.exit(0);
}

console.log("\nnpm will ask for your OTP. Publishing...\n");
let published = 0;
for (const pkg of queue) {
  console.log(`--- [${published + 1}/${queue.length}] ${pkg.name}@${pkg.version} (${pkg.dir})`);
  const result = spawnSync("npm", ["publish", "--access", "public", "--registry", REGISTRY], {
    cwd: pkg.dir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\nFAILED at ${pkg.name}@${pkg.version} (exit ${result.status}).`);
    console.error(`${published} package(s) published before this one. Fix the cause and re-run —`);
    console.error("already-published packages are skipped, so the run resumes where it stopped.");
    process.exit(1);
  }
  published += 1;
}
console.log(`\nDone. ${published} package(s) published.`);
