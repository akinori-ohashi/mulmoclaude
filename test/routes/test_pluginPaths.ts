import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMarkdownPath } from "../../server/utils/files/markdown-store.js";

// isMarkdownPath is a validation gate in server/api/routes/plugins.ts PUT
// handlers, so exercising it here covers the route layer's path-checking logic.

describe("isMarkdownPath", () => {
  it("accepts a canonical markdown path", () => {
    assert.equal(isMarkdownPath("artifacts/documents/abc123.md"), true);
  });

  it("accepts a UUID-like filename", () => {
    assert.equal(isMarkdownPath("artifacts/documents/a1b2c3d4e5f67890.md"), true);
  });

  it("rejects non-markdown prefixes", () => {
    assert.equal(isMarkdownPath("artifacts/images/foo.md"), false);
    assert.equal(isMarkdownPath("documents/foo.md"), false);
    assert.equal(isMarkdownPath("markdowns/foo.md"), false);
    assert.equal(isMarkdownPath("foo.md"), false);
  });

  it("rejects non-.md extensions", () => {
    assert.equal(isMarkdownPath("artifacts/documents/foo.json"), false);
    assert.equal(isMarkdownPath("artifacts/documents/foo.txt"), false);
    assert.equal(isMarkdownPath("artifacts/documents/foo.png"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isMarkdownPath(""), false);
  });

  it("rejects path with only the prefix", () => {
    assert.equal(isMarkdownPath("artifacts/documents/"), false);
  });
});

// `overwriteMarkdown` does no realpath / safeResolve before writing, so this
// gate is the primary defence at the route layer.
describe("isMarkdownPath — traversal awareness", () => {
  it("isMarkdownPath rejects path-normalized traversal", () => {
    assert.equal(isMarkdownPath("artifacts/documents/../documents/f.md"), false);
  });

  it("isMarkdownPath rejects double-dot segments", () => {
    assert.equal(isMarkdownPath("artifacts/documents/../../etc/passwd.md"), false);
  });
});
