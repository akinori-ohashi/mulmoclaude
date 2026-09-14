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
import { execFileSync, execSync, spawnSync } from "node:child_process";

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

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const parseVersion = (version, what) => {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`${what}: "${version}" is not a plain x.y.z version — resolve it by hand`);
  return match.slice(1, 4).map(Number);
};

const compareVersions = (a, b, what) => {
  const left = parseVersion(a, what);
  const right = parseVersion(b, what);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
};

// "not published yet" and "the registry did not answer" must not look alike:
// treating a network or auth failure as `null` would queue a package that is
// already live, and npm would reject it partway through the run.
const npmVersion = (name) => {
  try {
    const args = ["view", name, "version", "--registry", REGISTRY];
    return { version: execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    if (/E404|is not in this registry|404 Not Found/.test(stderr)) return { version: null };
    return { version: null, error: stderr.split("\n").find((l) => l.trim()) ?? error.message };
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
const lookupFailures = [];
order.forEach((name) => {
  const pkg = packages.get(name);
  const { version: live, error } = npmVersion(name);
  if (error) {
    lookupFailures.push(`${name}: ${error}`);
    return;
  }
  if (live === pkg.version) return;
  if (name === LAUNCHER) {
    console.log(`SKIP  ${name} — the launcher ships through /publish-mulmoclaude, not this script`);
    return;
  }
  // Only ever move forward. npm ahead of the workspace means someone published
  // from elsewhere; publishing the older local number would be rejected anyway,
  // and it would be rejected midway through a run that has already shipped others.
  if (live && compareVersions(pkg.version, live, name) < 0) {
    console.log(`SKIP  ${name} — npm serves ${live}, newer than the workspace's ${pkg.version}. Pull it in first.`);
    return;
  }
  queue.push({ ...pkg, live });
});

if (lookupFailures.length > 0) {
  console.error("\nThe registry did not answer for:");
  lookupFailures.forEach((f) => console.error(`  ${f}`));
  console.error("\nRefusing to publish: a lookup failure is not proof a package is unpublished.");
  process.exit(1);
}

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
