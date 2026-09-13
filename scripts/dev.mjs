#!/usr/bin/env node
// The `yarn dev` entry point, so its CLI flags reach the whole chain (#3113).
//
// `dev` used to be three commands joined with `&&` directly in package.json.
// yarn appends a script's trailing args to the LAST of those only, so
// `yarn dev --disable-sandbox` handed the flag to `concurrently`, which drops
// what it does not recognise — and the two commands that read flags run BEFORE
// it. Every flag in the registry was a silent no-op here.
//
// Running the chain from a script instead is what lets the flags be translated
// to env ONCE, up front, where every step of the chain inherits them. The step
// commands below are otherwise the same strings package.json used to hold: the
// shell that runs them is the same shell, so nothing about the no-flag path
// changes.
import { spawnSync } from "node:child_process";

import { CLI_FLAGS } from "../server/utils/cli-flags.mjs";
import { parseDevArgs } from "./lib/devArgs.mjs";
import { VARIANTS } from "./lib/devChain.mjs";

function main() {
  const parsed = parseDevArgs(process.argv.slice(2), CLI_FLAGS);
  if (!parsed.ok) {
    console.error(parsed.reason);
    process.exit(1);
  }
  const steps = VARIANTS[parsed.variant];
  if (steps === undefined) {
    console.error(`Unknown dev variant "${parsed.variant}" — expected one of: ${Object.keys(VARIANTS).join(", ")}`);
    process.exit(1);
  }
  Object.entries(parsed.env).forEach(([name, value]) => console.log(`[dev] ${name}=${value}`));
  runChain(steps, { ...process.env, ...parsed.env });
}

/** Stops at the first failure, the way `&&` did. */
function runChain(steps, env) {
  for (const step of steps) {
    // `shell: true` because these ARE the shell strings package.json held; the
    // quoting inside `concurrently`'s arguments has to be read the same way.
    const { status, signal } = spawnSync(step, { shell: true, stdio: "inherit", env });
    if (signal !== null) process.exit(1);
    if (status !== 0) process.exit(status ?? 1);
  }
}

main();
