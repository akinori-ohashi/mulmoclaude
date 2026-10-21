import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { openVerifiedWithinRoot, resolveExistingWithinRoot, writeFileVerifiedInDir } from "../../src/files/verified.js";

// A race is simulated by swapping `root/dir` for a symlink to `outside` (and back) at a hook.
let base = "";
let root = "";
let outside = "";
let dir = "";

const swapOut = async (): Promise<void> => {
  renameSync(dir, `${dir}-real`);
  symlinkSync(outside, dir);
};
const swapBack = async (): Promise<void> => {
  unlinkSync(dir);
  renameSync(`${dir}-real`, dir);
};

const readThrough = async (relative: string, hooks: Parameters<typeof openVerifiedWithinRoot>[2]): Promise<string | null> => {
  const handle = await openVerifiedWithinRoot(root, relative, hooks);
  if (handle === null) return null;
  try {
    return (await handle.readFile()).toString("utf-8");
  } finally {
    await handle.close();
  }
};

describe("verified file access", () => {
  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "verified-")));
    root = path.join(base, "root");
    outside = path.join(base, "outside");
    dir = path.join(root, "dir");
    mkdirSync(dir, { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(dir, "in.json"), "inside");
    writeFileSync(path.join(outside, "in.json"), "secret");
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("reads an in-root file through the verified handle", async () => {
    assert.equal(await readThrough("dir/in.json", {}), "inside");
  });

  it("refuses a handle opened while a parent was swapped out, even if it is swapped back before the check", async () => {
    assert.equal(await readThrough("dir/in.json", { beforeOpen: swapOut, afterOpen: swapBack }), null);
  });

  it("refuses when the parent is swapped out after the open and left there", async () => {
    assert.equal(await readThrough("dir/in.json", { afterOpen: swapOut }), null);
  });

  // The root pathname itself renamed away and another directory moved into its place.
  const replaceRoot = async (): Promise<void> => {
    renameSync(root, `${root}-original`);
    mkdirSync(path.join(outside, "dir"));
    writeFileSync(path.join(outside, "dir", "in.json"), "replacement");
    renameSync(outside, root);
  };

  it("refuses a read when the root directory is replaced mid-call", async () => {
    assert.equal(await readThrough("dir/in.json", { beforeOpen: replaceRoot }), null);
  });

  it("refuses a write when the root directory is replaced mid-call", async () => {
    await assert.rejects(writeFileVerifiedInDir(root, dir, "in.json", "planted", { beforeOpen: replaceRoot }), /left the scope/);
    assert.equal(readFileSync(path.join(root, "dir", "in.json"), "utf8"), "replacement");
    assert.equal(readFileSync(path.join(`${root}-original`, "dir", "in.json"), "utf8"), "inside");
  });

  it("reports a missing or outside path as null", async () => {
    assert.equal(await readThrough("dir/none.json", {}), null);
    assert.equal(await readThrough("../outside/in.json", {}), null);
    symlinkSync(outside, path.join(root, "link"));
    assert.equal(await resolveExistingWithinRoot(root, "link/in.json"), null);
  });

  it("writes atomically into a verified directory", async () => {
    await writeFileVerifiedInDir(root, dir, "new.json", "written");
    assert.equal(readFileSync(path.join(dir, "new.json"), "utf8"), "written");
    assert.deepEqual(readdirSync(dir).sort(), ["in.json", "new.json"]);
  });

  it("writes nothing outside when the parent is swapped before the staging file is created", async () => {
    await assert.rejects(writeFileVerifiedInDir(root, dir, "in.json", "planted", { beforeOpen: swapOut, afterOpen: swapBack }), /left the scope/);
    assert.equal(readFileSync(path.join(outside, "in.json"), "utf8"), "secret");
    assert.equal(readFileSync(path.join(dir, "in.json"), "utf8"), "inside");
    readdirSync(outside).forEach((name) => assert.notEqual(readFileSync(path.join(outside, name), "utf8"), "planted"));
  });

  it("fails rather than renaming outside when the parent is swapped after verification", async () => {
    await assert.rejects(writeFileVerifiedInDir(root, dir, "in.json", "planted", { beforeRename: swapOut }));
    assert.equal(readFileSync(path.join(outside, "in.json"), "utf8"), "secret");
    assert.deepEqual(readdirSync(outside), ["in.json"]);
  });
});
