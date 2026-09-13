// What `yarn dev --<flag>` should mean, as a pure function (#3113).
//
// It never meant anything. `dev` is a compound `a && b && c` script and yarn
// appends trailing args to the LAST command only, so the flag landed on
// `concurrently`, which silently swallows it — while the guard and the server
// that were supposed to read it run in the earlier commands. Measured:
//
//   $ yarn chain --allow-multiple-instances   # "node show.js A && node show.js B"
//   A argv=[]
//   B argv=["--allow-multiple-instances"]
//
// So all six flags in the registry were no-ops on `yarn dev`, while
// `docs/developer.md` and `helps/sandbox.md` said otherwise, since #1089.
//
// Plain `.mjs`: `yarn dev` runs this under bare node with no tsx, for the same
// reason `cli-flags.mjs` is not TypeScript. Sibling `devArgs.d.mts` has the types.

/**
 * Split argv into the variant to run and the env the flags ask for.
 *
 * An unrecognised `--flag` is REFUSED rather than ignored. Ignoring it is the
 * bug this file exists to fix, one typo removed: a flag that does nothing looks
 * exactly like a flag that worked.
 *
 * @param {readonly string[]} argv args after the script name
 * @param {ReadonlyArray<{ flag: string, env: string }>} flags the CLI_FLAGS registry
 * @returns {{ ok: true, variant: string, env: Record<string, "1"> } | { ok: false, reason: string }}
 */
export function parseDevArgs(argv, flags) {
  const known = new Set(flags.map(({ flag }) => flag));
  const unknown = argv.filter((arg) => arg.startsWith("-") && !known.has(arg));
  if (unknown.length > 0) {
    return { ok: false, reason: unknownFlagMessage(unknown, flags) };
  }
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  if (positional.length > 1) {
    return { ok: false, reason: `Expected at most one variant, got: ${positional.join(", ")}` };
  }
  return { ok: true, variant: positional[0] ?? "dev", env: envFor(argv, flags) };
}

/** @returns {Record<string, "1">} */
function envFor(argv, flags) {
  const env = {};
  flags.forEach(({ flag, env: name }) => {
    if (argv.includes(flag)) env[name] = "1";
  });
  return env;
}

/** @returns {string} */
function unknownFlagMessage(unknown, flags) {
  const lines = [`Unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`];
  lines.push("Known flags:");
  flags.forEach(({ flag, env }) => lines.push(`  ${flag}  (= ${env}=1)`));
  return lines.join("\n");
}
