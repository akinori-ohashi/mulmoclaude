// MulmoClaude's wiring of the `kenteiscript` package (manageKenteiScript):
// the host's job is to hand the package `files.byPath` (`.json` only) so the
// tool's `path` argument works, and to route the View's `{ kind: "grade" }`
// dispatch — and nothing else — to the package. The package's own behaviour
// (schema, authoring rules, JEV grading) is tested in its repo.
//
// No test here reaches JEV: grading calls stop at the key check or at the
// package's argument check before any network request.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MISSING_KEY_MESSAGE, SAMPLE_SCRIPT } from "kenteiscript/plugin";
import { executeKenteiScript } from "../../server/plugins/kentei-builtin.js";
import { getBuiltinDispatch } from "../../server/plugins/builtin-dispatch.js";
import { isRecord } from "../../server/utils/types.js";

const KEY = "TYPESAFE_API_KEY";

function messageOf(result: unknown): string {
  assert.ok(isRecord(result), "the executor returns an object");
  assert.equal(typeof result.message, "string");
  return String(result.message);
}

function withKey(value: string | undefined): void {
  if (value === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = value;
}

describe("kentei built-in", () => {
  const savedKey = process.env[KEY];
  let dir = "";

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kentei-builtin-"));
    writeFileSync(path.join(dir, "quiz.json"), JSON.stringify(SAMPLE_SCRIPT));
    writeFileSync(path.join(dir, "quiz.txt"), JSON.stringify(SAMPLE_SCRIPT));
  });

  after(() => {
    withKey(savedKey);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a `path` through files.byPath (absolute .json)", async () => {
    withKey("dummy");
    const message = messageOf(await executeKenteiScript({}, { action: "checkScript", path: path.join(dir, "quiz.json") }));
    assert.match(message, /valid KenteiScript/);
  });

  it("refuses a `path` that is not .json", async () => {
    withKey("dummy");
    const message = messageOf(await executeKenteiScript({}, { action: "checkScript", path: path.join(dir, "quiz.txt") }));
    assert.doesNotMatch(message, /valid KenteiScript/);
  });

  it("fails every action with MISSING_KEY_MESSAGE when TYPESAFE_API_KEY is unset", async () => {
    withKey(undefined);
    for (const action of ["getGuide", "getSchema", "checkScript", "present"]) {
      const result = await executeKenteiScript({}, { action, script: SAMPLE_SCRIPT });
      assert.equal(messageOf(result), MISSING_KEY_MESSAGE, action);
      assert.ok(isRecord(result) && result.data === undefined, `${action} returns no data`);
    }
  });

  it("registers a dispatch handler under the View's scope", () => {
    assert.equal(typeof getBuiltinDispatch("kentei"), "function");
  });

  it("dispatch refuses anything but a grade request", async () => {
    withKey("dummy");
    const handler = getBuiltinDispatch("kentei");
    assert.ok(handler);
    await assert.rejects(handler({ action: "getGuide" }), /unrecognised dispatch payload/);
  });

  it("dispatch hands a grade request to the package", async () => {
    const handler = getBuiltinDispatch("kentei");
    assert.ok(handler);
    withKey(undefined);
    await assert.rejects(handler({ kind: "grade", script: SAMPLE_SCRIPT, questionId: "x", answer: "y" }), /TYPESAFE_API_KEY/);
    withKey("dummy");
    // Malformed on purpose: the package rejects it before calling JEV.
    await assert.rejects(handler({ kind: "grade", script: SAMPLE_SCRIPT }), /questionId and answer must be strings/);
  });
});
