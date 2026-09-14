// What `yarn dev --<flag>` means (#3113).
//
// The flags were silent no-ops on `yarn dev` for as long as the script was a
// compound `a && b && c` in package.json: yarn hands trailing args to the LAST
// command only, and the steps that read flags run before it. The rule now lives
// in one pure function, so the two ways it can go wrong — a known flag that
// fails to become an env var, and an unknown flag that is quietly ignored —
// are both pinned here rather than discovered by a user whose flag did nothing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseDevArgs } from "../../scripts/lib/devArgs.mjs";
import { CLI_FLAGS } from "../../server/utils/cli-flags.mjs";

const FLAGS = [
  { flag: "--disable-sandbox", env: "DISABLE_SANDBOX" },
  { flag: "--allow-multiple-instances", env: "MULMOCLAUDE_ALLOW_MULTIPLE_INSTANCES" },
] as const;

/** Narrows to the success shape, failing with the parser's own reason if it did not. */
const ok = (argv: readonly string[]): { variant: string; env: Record<string, "1"> } => {
  const parsed = parseDevArgs(argv, FLAGS);
  assert.ok(parsed.ok, parsed.ok === false ? parsed.reason : "");
  return parsed;
};

describe("parseDevArgs — variant selection", () => {
  it("defaults to the plain dev chain", () => {
    assert.equal(ok([]).variant, "dev");
  });

  it("takes the variant from the single positional argument", () => {
    assert.equal(ok(["debug"]).variant, "debug");
    assert.equal(ok(["full-build"]).variant, "full-build");
  });

  it("reads the variant whichever side of the flags it sits on", () => {
    assert.equal(ok(["debug", "--disable-sandbox"]).variant, "debug");
    assert.equal(ok(["--disable-sandbox", "debug"]).variant, "debug");
  });

  it("refuses two positionals rather than silently picking one", () => {
    const parsed = parseDevArgs(["debug", "full-build"], FLAGS);
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok === false ? parsed.reason : "", /at most one variant/);
  });
});

describe("parseDevArgs — flags become env", () => {
  it("maps a known flag to its env var", () => {
    assert.deepEqual(ok(["--disable-sandbox"]).env, { DISABLE_SANDBOX: "1" });
  });

  it("maps several at once", () => {
    assert.deepEqual(ok(["--disable-sandbox", "--allow-multiple-instances"]).env, {
      DISABLE_SANDBOX: "1",
      MULMOCLAUDE_ALLOW_MULTIPLE_INSTANCES: "1",
    });
  });

  it("sets nothing when no flag is given", () => {
    assert.deepEqual(ok(["debug"]).env, {});
  });

  it("is not fooled by a flag-shaped positional", () => {
    assert.equal(ok(["--disable-sandbox"]).variant, "dev");
  });
});

describe("parseDevArgs — an unknown flag is refused, not ignored", () => {
  // Ignoring it is the bug this file exists to fix, one typo removed: a flag
  // that does nothing looks exactly like a flag that worked.
  it("rejects a misspelt flag", () => {
    const parsed = parseDevArgs(["--disable-sandbo"], FLAGS);
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok === false ? parsed.reason : "", /Unknown option: --disable-sandbo/);
  });

  it("names every unknown one, and lists what is valid", () => {
    const parsed = parseDevArgs(["--nope", "--also-nope"], FLAGS);
    assert.equal(parsed.ok, false);
    const reason = parsed.ok === false ? parsed.reason : "";
    assert.match(reason, /Unknown options: --nope, --also-nope/);
    assert.match(reason, /--disable-sandbox/);
    assert.match(reason, /DISABLE_SANDBOX=1/);
  });

  it("rejects a single dash too", () => {
    assert.equal(parseDevArgs(["-x"], FLAGS).ok, false);
  });
});

describe("parseDevArgs — against the REAL registry", () => {
  // The tests above inject a two-flag stand-in so they state their own inputs.
  // This one runs the rule over what actually ships, so a flag added to the
  // registry is covered without anybody remembering to update this file.
  it("accepts every flag the registry declares, and maps each to its env var", () => {
    const argv = CLI_FLAGS.map(({ flag }) => flag);
    const parsed = parseDevArgs(argv, CLI_FLAGS);
    assert.ok(parsed.ok, parsed.ok === false ? parsed.reason : "");
    const expected = Object.fromEntries(CLI_FLAGS.map(({ env }) => [env, "1"]));
    assert.deepEqual(parsed.env, expected);
  });

  it("covers more than one flag, or the check above proves little", () => {
    assert.ok(CLI_FLAGS.length >= 6, `expected the full registry, saw ${CLI_FLAGS.length}`);
  });
});
