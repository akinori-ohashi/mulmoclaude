// The text/binary policy the whole file API leans on: membership in this set
// makes a file previewable AND editable through `/api/files/content`, so a
// wrong entry is either an unreachable file or an open write surface. These
// assertions pin the rules the module's header comment states — the list
// itself is long enough that an accidental paste is easy to miss in review.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TEXT_EXTENSIONS } from "../../../server/utils/files/text-extensions.js";

describe("TEXT_EXTENSIONS shape", () => {
  it("holds only lower-case, dot-prefixed extensions", () => {
    for (const ext of TEXT_EXTENSIONS) {
      assert.equal(ext, ext.toLowerCase(), `${ext} is not lower-case`);
      assert.ok(ext.startsWith("."), `${ext} does not start with a dot`);
      assert.equal(ext.slice(1).includes("."), false, `${ext} carries a second dot`);
    }
  });
});

describe("TEXT_EXTENSIONS excludes", () => {
  it("every extension whose job is to hold a secret", () => {
    // `.env` was in this set once and made /files/content serve the
    // workspace credentials; `isSensitivePath` is the other half of the
    // guard, not a reason to relax this one.
    for (const ext of [".env", ".pem", ".key", ".crt", ".p12", ".pfx", ".npmrc", ".netrc", ".htpasswd", ".tfstate"]) {
      assert.equal(TEXT_EXTENSIONS.has(ext), false, `${ext} must not be previewable/editable text`);
    }
  });

  it("container formats that merely contain text", () => {
    for (const ext of [".xlsx", ".docx", ".pptx", ".zip", ".gz", ".tgz", ".kmz", ".svgz", ".usdz", ".epub"]) {
      assert.equal(TEXT_EXTENSIONS.has(ext), false, `${ext} is an archive, not text`);
    }
  });

  it("formats that are text only sometimes", () => {
    for (const ext of [".plist", ".rtf"]) {
      assert.equal(TEXT_EXTENSIONS.has(ext), false, `${ext} cannot be assumed to be plain text`);
    }
  });

  it("the media extensions the other classifier branches own", () => {
    // classify() checks TEXT first, so an overlap here would silently win
    // over the image/audio/video branch and break a working preview.
    for (const ext of [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".svg",
      ".bmp",
      ".avif",
      ".ico",
      ".pdf",
      ".mp3",
      ".wav",
      ".m4a",
      ".ogg",
      ".oga",
      ".flac",
      ".aac",
      ".mp4",
      ".webm",
      ".mov",
      ".m4v",
      ".ogv",
    ]) {
      assert.equal(TEXT_EXTENSIONS.has(ext), false, `${ext} is claimed by another classify() branch`);
    }
  });
});

describe("TEXT_EXTENSIONS includes", () => {
  it("the subtitle family #3213 was reported against", () => {
    for (const ext of [".srt", ".vtt", ".ass", ".ssa", ".sbv", ".sub", ".lrc"]) {
      assert.ok(TEXT_EXTENSIONS.has(ext), `${ext} missing`);
    }
  });

  it("the plain-text artifacts this product itself writes", () => {
    // `.shape` is ShapeScript source saved by the shape tools into
    // artifacts/shapes/; the Files view used to call it binary.
    for (const ext of [".shape", ".md", ".json", ".jsonl", ".html", ".csv"]) {
      assert.ok(TEXT_EXTENSIONS.has(ext), `${ext} missing`);
    }
  });

  it("the extensions a real workspace survey turned up as unreadable", () => {
    for (const ext of [".xsd", ".map", ".rules", ".utf8", ".xml", ".toml"]) {
      assert.ok(TEXT_EXTENSIONS.has(ext), `${ext} missing`);
    }
  });
});
