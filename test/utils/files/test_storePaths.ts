import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { storeRelativePath, storeTrustedRoot } from "../../../server/utils/files/storePaths.js";

const WORKSPACE = path.resolve("/ws");

describe("storeTrustedRoot", () => {
  it("is the folder the store's own path sits in", () => {
    assert.equal(storeTrustedRoot(path.join(WORKSPACE, "artifacts", "images"), "artifacts/images"), WORKSPACE);
    assert.equal(storeTrustedRoot(path.join(WORKSPACE, "data", "attachments"), "data/attachments"), WORKSPACE);
    assert.equal(storeTrustedRoot(`${path.join(WORKSPACE, "data", "attachments")}${path.sep}`, "data/attachments"), WORKSPACE);
  });

  it("is null when the root does not end in the store's folder", () => {
    assert.equal(storeTrustedRoot(path.join(WORKSPACE, "artifacts", "pictures"), "artifacts/images"), null);
    assert.equal(storeTrustedRoot(path.join(WORKSPACE, "images"), "artifacts/images"), null);
    assert.equal(storeTrustedRoot(path.join(WORKSPACE, "other", "attachments"), "data/attachments"), null);
  });
});

describe("storeRelativePath", () => {
  it("strips the store prefix and keeps a path inside the store", () => {
    assert.equal(storeRelativePath("artifacts/images/2026/10/a.png", "artifacts/images"), "2026/10/a.png");
    assert.equal(storeRelativePath("2026/10/a.png", "artifacts/images"), "2026/10/a.png");
    assert.equal(storeRelativePath("artifacts/images/2026/../a.png", "artifacts/images"), "a.png");
    assert.equal(storeRelativePath("artifacts/images/2026\\10\\a.png", "artifacts/images"), "2026/10/a.png");
    assert.equal(storeRelativePath("artifacts\\images\\2026\\a.png", "artifacts/images"), "2026/a.png");
  });

  it("is null for an empty, absolute, drive-qualified, NUL-bearing or escaping path", () => {
    const refused = [
      "",
      "artifacts/images/",
      "artifacts/images/.",
      "/etc/passwd",
      "C:secret.png",
      "c:\\secret.png",
      "artifacts/images/a\0.png",
      "..",
      "../README.md",
      "artifacts/images/../../README.md",
      "artifacts/images/2026/../../x.png",
      "..\\x.png",
      "\\secret.png",
      "\\\\server\\share\\x.png",
      "artifacts/images/\\secret.png",
      "artifacts\\images\\..\\..\\x.png",
    ];
    refused.forEach((input) => assert.equal(storeRelativePath(input, "artifacts/images"), null, JSON.stringify(input)));
  });
});
