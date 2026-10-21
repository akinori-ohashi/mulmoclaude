import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeConfinedFileOps } from "../../server/plugins/confined-file-ops.js";

const base = mkdtempSync(path.join(tmpdir(), "confined-ops-"));
const root = path.join(base, "artifacts");
const outside = path.join(base, "outside");
const ops = makeConfinedFileOps(root);

const isEnoent = (err: unknown): boolean => err instanceof Error && "code" in err && err.code === "ENOENT";

describe("makeConfinedFileOps", () => {
  before(() => {
    mkdirSync(path.join(root, "sheets"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(root, "sheets", "in.json"), "inside");
    writeFileSync(path.join(outside, "secret.json"), "secret");
    symlinkSync(path.join(outside, "secret.json"), path.join(root, "sheets", "file-link.json"));
    symlinkSync(outside, path.join(root, "sheets", "dir-link"));
    symlinkSync(path.join(root, "sheets"), path.join(root, "inner-link"));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  it("reads, stats and lists files inside the root", async () => {
    assert.equal(await ops.read("sheets/in.json"), "inside");
    assert.equal(new TextDecoder().decode(await ops.readBytes("sheets/in.json")), "inside");
    assert.equal((await ops.stat("sheets/in.json")).size, "inside".length);
    assert.equal(await ops.exists("sheets/in.json"), true);
    assert.ok((await ops.readDir("sheets")).includes("in.json"));
  });

  it("writes inside the root, creating parent directories", async () => {
    await ops.write("sheets/2026/10/new.json", "written");
    assert.equal(readFileSync(path.join(root, "sheets", "2026", "10", "new.json"), "utf8"), "written");
  });

  it("follows a symlink that stays inside the root", async () => {
    assert.equal(await ops.read("inner-link/in.json"), "inside");
    await ops.write("inner-link/via-link.json", "ok");
    assert.equal(readFileSync(path.join(root, "sheets", "via-link.json"), "utf8"), "ok");
  });

  it("refuses to read through a file symlink that leads out", async () => {
    await assert.rejects(ops.read("sheets/file-link.json"), isEnoent);
    await assert.rejects(ops.readBytes("sheets/file-link.json"), isEnoent);
    await assert.rejects(ops.stat("sheets/file-link.json"), isEnoent);
    assert.equal(await ops.exists("sheets/file-link.json"), false);
  });

  it("refuses to read or list through a directory symlink that leads out", async () => {
    await assert.rejects(ops.read("sheets/dir-link/secret.json"), isEnoent);
    assert.deepEqual(await ops.readDir("sheets/dir-link"), []);
  });

  it("refuses to write through a directory symlink that leads out, leaving the outside untouched", async () => {
    await assert.rejects(ops.write("sheets/dir-link/planted.json", "x"), /outside the scope/);
    assert.deepEqual(readdirSync(outside).sort(), ["secret.json"]);
  });

  it("replaces a leaf symlink rather than writing through it", async () => {
    await ops.write("sheets/file-link.json", "replaced");
    assert.equal(readFileSync(path.join(outside, "secret.json"), "utf8"), "secret");
  });

  it("removes a symlink that leads out, never its target", async () => {
    symlinkSync(path.join(outside, "secret.json"), path.join(root, "sheets", "unlink-link.json"));
    await ops.unlink("sheets/unlink-link.json");
    assert.equal(readFileSync(path.join(outside, "secret.json"), "utf8"), "secret");
    assert.equal(readdirSync(path.join(root, "sheets")).includes("unlink-link.json"), false);
  });

  it("removes an in-root symlink, never its target", async () => {
    symlinkSync(path.join(root, "sheets", "in.json"), path.join(root, "sheets", "alias.json"));
    await ops.unlink("sheets/alias.json");
    assert.equal(readFileSync(path.join(root, "sheets", "in.json"), "utf8"), "inside");
    assert.equal(readdirSync(path.join(root, "sheets")).includes("alias.json"), false);
  });

  it("does not delete through a directory symlink that leads out", async () => {
    await ops.unlink("sheets/dir-link/secret.json");
    assert.equal(readFileSync(path.join(outside, "secret.json"), "utf8"), "secret");
  });

  it("refuses parent traversal and absolute paths before touching the disk", async () => {
    await assert.rejects(ops.read("../outside/secret.json"), /escapes plugin scope/);
    await assert.rejects(ops.read(path.join(outside, "secret.json")), /escapes plugin scope/);
    await assert.rejects(ops.write("../outside/planted.json", "x"), /escapes plugin scope/);
    await assert.rejects(ops.unlink("../outside/secret.json"), /escapes plugin scope/);
    assert.deepEqual(readdirSync(outside).sort(), ["secret.json"]);
  });

  it("accepts Windows-style backslash separators", async () => {
    await ops.write("sheets\\win\\file.json", "win");
    assert.equal(await ops.read("sheets/win/file.json"), "win");
  });

  it("reports a missing file as missing", async () => {
    assert.equal(await ops.exists("sheets/none.json"), false);
    await assert.rejects(ops.read("sheets/none.json"), isEnoent);
    assert.deepEqual(await ops.readDir("nothing-here"), []);
    await ops.unlink("sheets/none.json");
  });
});
