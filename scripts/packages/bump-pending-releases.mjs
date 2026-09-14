// Bumps every publishable workspace whose published tarball or manifest has drifted,
// and sweeps every declared range on the bumped package to the new version.
//
// Drift classification comes from `audit:releases` — it is the one that knows which
// changed files actually feed the tarball, so this script only applies its decision
// rather than re-deriving it.
//
// The launcher's OWN version is never bumped here; that field belongs to
// /publish-mulmoclaude. Its declared RANGES are swept like every other consumer's.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LAUNCHER = "mulmoclaude";
const INTERNAL = /^(@mulmoclaude\/|@mulmobridge\/|mulmoclaude$)/;
const RANGE_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const PLAIN_CARET = /^\^\d+\.\d+\.\d+$/;
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
const DRY_RUN = process.argv.includes("--dry-run");

const auditRows = () => {
  const out = execSync("node scripts/packages/audit-releases.mjs", { encoding: "utf8", maxBuffer: 1 << 26 })
    .replace(ANSI, "")
    .split("\n");
  const rows = [];
  out.forEach((line) => {
    const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(clean|manifest drift|code drift|untagged|unpublished)\b/);
    if (match) rows.push({ name: match[1], local: match[2], npm: match[3], state: match[4] });
  });
  return rows;
};

const manifestFiles = execSync("find . -name package.json -not -path '*/node_modules/*' -not -path './.git/*' -not -path './test/*'", {
  encoding: "utf8",
  maxBuffer: 1 << 26,
})
  .trim()
  .split("\n")
  .map((f) => f.replace(/^\.\//, ""));

const manifests = manifestFiles.map((file) => ({ file, json: JSON.parse(readFileSync(file, "utf8")) }));
const publishable = new Map();
manifests.forEach(({ file, json }) => {
  if (json.name && INTERNAL.test(json.name) && !json.private) publishable.set(json.name, { file, json });
});

const bumpPatch = (version) => {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
};

const decide = (row) => {
  if (row.local !== row.npm) return { action: "publish as-is", newVersion: row.local };
  if (row.name === LAUNCHER) return { action: "SKIP - launcher version belongs to /publish-mulmoclaude", newVersion: row.local };
  return { action: "bump", newVersion: bumpPatch(row.local) };
};

const decisions = [];
auditRows().forEach((row) => {
  if (!publishable.has(row.name)) return;
  if (["clean", "unpublished", "untagged"].includes(row.state)) return;
  decisions.push({ ...row, ...decide(row) });
});

const edits = new Map();
const readText = (file) => edits.get(file) ?? readFileSync(file, "utf8");

let bumped = 0;
decisions
  .filter((d) => d.action === "bump")
  .forEach((d) => {
    const { file } = publishable.get(d.name);
    const text = readText(file);
    const needle = `"version": "${d.local}"`;
    if (!text.includes(needle)) throw new Error(`${d.name}: ${needle} not found in ${file}`);
    edits.set(file, text.replace(needle, `"version": "${d.newVersion}"`));
    bumped += 1;
  });

const changed = new Map(decisions.filter((d) => d.newVersion !== d.npm).map((d) => [d.name, d.newVersion]));
let swept = 0;
manifests.forEach(({ file, json }) => {
  let text = readText(file);
  let touched = false;
  RANGE_SECTIONS.forEach((section) => {
    Object.entries(json[section] ?? {}).forEach(([dep, range]) => {
      const target = changed.get(dep);
      if (!target) return;
      const want = `^${target}`;
      if (range === want) return;
      if (!PLAIN_CARET.test(range)) {
        console.warn(`  ! ${file} [${section}] ${dep}=${range} is not a plain caret - left alone`);
        return;
      }
      const needle = `"${dep}": "${range}"`;
      if (!text.includes(needle)) {
        console.warn(`  ! ${file}: ${needle} not found`);
        return;
      }
      text = text.replace(needle, `"${dep}": "${want}"`);
      touched = true;
      swept += 1;
    });
  });
  if (touched) edits.set(file, text);
});

console.log(`decisions: ${decisions.length}`);
decisions.forEach((d) => {
  console.log(`  ${d.name.padEnd(34)} ${d.local.padEnd(8)} npm=${String(d.npm).padEnd(8)} -> ${d.newVersion.padEnd(8)} ${d.action}`);
});
console.log(`\nversion bumps: ${bumped}`);
console.log(`range declarations swept: ${swept}`);
console.log(`files to write: ${edits.size}`);
if (DRY_RUN) {
  console.log("\n--dry-run: nothing written");
  process.exit(0);
}
edits.forEach((text, file) => writeFileSync(file, text));
console.log("written");
