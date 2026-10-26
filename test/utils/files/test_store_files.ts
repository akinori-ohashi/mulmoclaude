import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeStoreFiles } from "../../../server/utils/files/store-files.js";

const PREFIX = "data/attachments";
let workspace: string;
let outside: string;
const storeRoot = (): string => path.join(workspace, "data", "attachments");
const store = makeStoreFiles(storeRoot, PREFIX);
const BYTES = Buffer.from("bytes");
const SECRET_MODE = 0o600;
const PERMISSION_BITS = 0o777;

describe("makeStoreFiles", () => {
  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "store-files-ws-")));
    outside = realpathSync(mkdtempSync(path.join(tmpdir(), "store-files-out-")));
    writeFileSync(path.join(outside, "secret.pdf"), "secret");
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("creates the store and its partition on the first write, and reads it back", async () => {
    await store.write(`${PREFIX}/2026/10/a.pdf`, BYTES);
    assert.deepEqual(readFileSync(path.join(storeRoot(), "2026", "10", "a.pdf")), BYTES);
    assert.deepEqual(await store.read(`${PREFIX}/2026/10/a.pdf`), BYTES);
    assert.equal(await store.isFile(`${PREFIX}/2026/10/a.pdf`), true);
    await store.write(`${PREFIX}/2026/10/a.pdf`, Buffer.from("again"));
    assert.equal((await store.read(`${PREFIX}/2026/10/a.pdf`)).toString(), "again");
  });

  it("applies the requested mode to the written file", { skip: process.platform === "win32" }, async () => {
    await store.write(`${PREFIX}/2026/10/a.pdf`, BYTES, { mode: SECRET_MODE });
    assert.equal(statSync(path.join(storeRoot(), "2026", "10", "a.pdf")).mode & PERMISSION_BITS, SECRET_MODE);
  });

  it("lists a folder of the store, and nothing for a missing or escaping one", async () => {
    await store.write(`${PREFIX}/2026/10/a.pdf`, BYTES);
    const names = async (dir: string): Promise<string[]> => (await store.listDir(dir)).map((entry) => entry.name);
    assert.deepEqual(await names(""), ["2026"]);
    assert.deepEqual(await names("2026/10"), ["a.pdf"]);
    assert.deepEqual(await names(`${PREFIX}/2026`), ["10"]);
    assert.deepEqual(await names("2026/10/a.pdf"), []);
    assert.deepEqual(await names("none"), []);
    assert.deepEqual(await names("../.."), []);
  });

  it("refuses a missing file, a directory and an escaping path", async () => {
    mkdirSync(path.join(storeRoot(), "dir.pdf"), { recursive: true });
    const refused = [`${PREFIX}/none.pdf`, `${PREFIX}/dir.pdf`, `${PREFIX}/../../secret.pdf`, "/etc/passwd"];
    await Promise.all(refused.map((input) => assert.rejects(() => store.read(input), /path traversal rejected/, input)));
    assert.deepEqual(await Promise.all(refused.map((input) => store.isFile(input))), [false, false, false, false]);
    await assert.rejects(() => store.write(`${PREFIX}/../../x.pdf`, BYTES), /path traversal rejected/);
  });

  it("does not follow a file link out of the store", async () => {
    mkdirSync(storeRoot(), { recursive: true });
    symlinkSync(path.join(outside, "secret.pdf"), path.join(storeRoot(), "link.pdf"));
    await assert.rejects(() => store.read(`${PREFIX}/link.pdf`), /path traversal rejected/);
    assert.equal(await store.isFile(`${PREFIX}/link.pdf`), false);
  });

  // The store folder, or the folder above it, replaced by a link: neither becomes the root.
  const linkedOut = [
    { name: "the store folder", link: (): string => storeRoot(), target: (): string => outside, secret: `${PREFIX}/secret.pdf` },
    { name: "its parent", link: (): string => path.join(workspace, "data"), target: (): string => outside, secret: `${PREFIX}/secret.pdf` },
  ];
  linkedOut.forEach(({ name, link, target, secret }) => {
    it(`reads, writes and finds nothing when ${name} is a link out of the workspace`, async () => {
      mkdirSync(path.join(outside, "attachments"), { recursive: true });
      writeFileSync(path.join(outside, "attachments", "secret.pdf"), "secret");
      mkdirSync(path.dirname(link()), { recursive: true });
      symlinkSync(target(), link(), "dir");
      await assert.rejects(() => store.read(secret), /path traversal rejected/);
      assert.equal(await store.isFile(secret), false);
      assert.deepEqual(await store.listDir(""), []);
      await assert.rejects(() => store.write(`${PREFIX}/2026/10/new.pdf`, BYTES), /refusing to write/);
      await assert.rejects(() => store.write(secret, BYTES), /refusing to write/);
      assert.equal(readFileSync(path.join(outside, "secret.pdf"), "utf8"), "secret");
      assert.equal(readFileSync(path.join(outside, "attachments", "secret.pdf"), "utf8"), "secret");
      assert.equal(existsSync(path.join(outside, "2026")), false);
      assert.equal(existsSync(path.join(outside, "attachments", "2026")), false);
      assert.deepEqual(readdirSync(outside).sort(), ["attachments", "secret.pdf"]);
    });
  });

  it("refuses a root that does not end in the store's folder", async () => {
    const misplaced = makeStoreFiles(() => path.join(workspace, "elsewhere"), PREFIX);
    await assert.rejects(() => misplaced.write(`${PREFIX}/a.pdf`, BYTES), /path traversal rejected/);
    await assert.rejects(() => misplaced.read(`${PREFIX}/a.pdf`), /path traversal rejected/);
    assert.equal(await misplaced.isFile(`${PREFIX}/a.pdf`), false);
  });
});
