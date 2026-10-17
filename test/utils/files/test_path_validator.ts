// Unit + smoke test for `makePathValidator` and the six store
// validators it now produces. The factory bundles both defenses
// historically used in isolation (`hasTraversalSegment` and
// `path.posix.normalize !== value` + `.includes("..")`) so that no
// store can drop one accidentally.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makePathValidator } from "../../../server/utils/files/path-validator.ts";
import { isAttachmentPath } from "../../../server/utils/files/attachment-store.ts";
import { isImagePath } from "../../../server/utils/files/image-store.ts";
import { isMarkdownPath } from "../../../server/utils/files/markdown-store.ts";
import { isHtmlPath } from "../../../server/utils/files/html-store.ts";
import { isSvgPath } from "../../../server/utils/files/svg-store.ts";

describe("makePathValidator — prefix + ext gates", () => {
  const validator = makePathValidator({ prefix: "data/things", ext: ".bin" });

  it("accepts the canonical shape", () => {
    assert.equal(validator("data/things/2026/06/abc.bin"), true);
    assert.equal(validator("data/things/abc.bin"), true);
  });

  it("rejects a wrong prefix", () => {
    assert.equal(validator("other/dir/abc.bin"), false);
    assert.equal(validator("data/things-other/abc.bin"), false);
    assert.equal(validator("data/things"), false);
  });

  it("rejects a wrong extension when ext is set", () => {
    assert.equal(validator("data/things/abc.txt"), false);
    assert.equal(validator("data/things/abc"), false);
  });

  it("accepts any extension when ext is omitted", () => {
    const any = makePathValidator({ prefix: "data/any" });
    assert.equal(any("data/any/abc.png"), true);
    assert.equal(any("data/any/abc.json"), true);
    assert.equal(any("data/any/abc"), true);
  });
});

describe("makePathValidator — canonical-form gate", () => {
  const validator = makePathValidator({ prefix: "data/things", ext: ".bin" });

  it("rejects double-slash (empty segment)", () => {
    assert.equal(validator("data/things//abc.bin"), false);
  });

  it("rejects a `.` segment", () => {
    assert.equal(validator("data/things/./abc.bin"), false);
  });

  it("rejects a `..` segment at any depth", () => {
    assert.equal(validator("data/things/../escape.bin"), false);
    assert.equal(validator("data/things/sub/../../etc/passwd.bin"), false);
  });

  it("rejects `..` after a backslash separator (Windows / encoded `%5C`)", () => {
    assert.equal(validator("data/things\\..\\escape.bin"), false);
  });

  it("rejects `..` substring inside a single segment (#1764 regression)", () => {
    // Pre-refactor markdown/html/spreadsheet/svg rejected these via
    // `normalized.includes("..")`. The factory must inherit that
    // guard; otherwise legitimate-looking filenames like `foo..bin`
    // / `v1..2.json` slip through.
    assert.equal(validator("data/things/foo..bin"), false);
    assert.equal(validator("data/things/prefix..suffix.bin"), false);
  });
});

describe("per-store validators — smoke", () => {
  // Each one should: accept its canonical shape, reject another
  // store's prefix, reject `..` traversal, reject empty segment.
  it("isAttachmentPath", () => {
    assert.equal(isAttachmentPath("data/attachments/2026/06/abc.pptx"), true);
    assert.equal(isAttachmentPath("data/attachments/abc.bin"), true);
    assert.equal(isAttachmentPath("artifacts/images/abc.png"), false);
    assert.equal(isAttachmentPath("data/attachments/../etc/x.pptx"), false);
    assert.equal(isAttachmentPath("data/attachments//abc.pptx"), false);
  });

  it("isImagePath (requires .png)", () => {
    assert.equal(isImagePath("artifacts/images/2026/06/abc.png"), true);
    assert.equal(isImagePath("artifacts/images/abc.jpg"), false);
    assert.equal(isImagePath("artifacts/images/../etc/x.png"), false);
    assert.equal(isImagePath("artifacts/images//abc.png"), false);
  });

  it("isMarkdownPath (requires .md)", () => {
    assert.equal(isMarkdownPath("artifacts/documents/2026/06/abc.md"), true);
    assert.equal(isMarkdownPath("artifacts/documents/abc.txt"), false);
    assert.equal(isMarkdownPath("artifacts/documents/../etc/x.md"), false);
    assert.equal(isMarkdownPath("artifacts/documents/foo..md"), false);
  });

  it("isHtmlPath (requires .html)", () => {
    assert.equal(isHtmlPath("artifacts/html/2026/06/abc.html"), true);
    assert.equal(isHtmlPath("artifacts/html/abc.htm"), false);
    assert.equal(isHtmlPath("artifacts/html/../etc/x.html"), false);
  });

  it("isSvgPath (requires .svg)", () => {
    assert.equal(isSvgPath("artifacts/svg/2026/06/abc.svg"), true);
    assert.equal(isSvgPath("artifacts/svg/abc.png"), false);
    assert.equal(isSvgPath("artifacts/svg/../etc/x.svg"), false);
  });
});
