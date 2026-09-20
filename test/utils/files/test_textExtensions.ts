// The text/binary policy the whole file API leans on: membership in this set
// makes a file previewable AND editable through `/api/files/content`, so a
// wrong entry is either an unreachable file or an open write surface. These
// assertions pin the rules the module's header comment states — the list
// itself is long enough that an accidental paste is easy to miss in review.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TEXT_EXTENSIONS } from "../../../server/utils/files/text-extensions.js";
import {
  AUDIO_EXTENSIONS,
  BLOCKED_UPLOAD_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isSensitivePath,
  isWritableTextFile,
} from "../../../server/api/routes/files.js";

// Names whose whole purpose is to hold a credential, split by the SHAPE of the
// guard that catches them — `isSensitivePath` matches some as a suffix and
// others as a whole filename, and asserting the wrong shape passes for the
// wrong reason. Named once so both halves of the guard (absence from
// TEXT_EXTENSIONS, refusal by isSensitivePath) are asserted over one list.
const SECRET_SHAPED_EXTENSIONS = [".env", ".pem", ".key", ".crt", ".p12", ".pfx", ".jks", ".keystore", ".tfstate", ".tfvars"];

// These are whole filenames, not suffixes: npm config is always `.npmrc`, never
// `prod.npmrc`. Listing them as extensions would assert nothing.
const SECRET_SHAPED_BASENAMES = [".npmrc", ".netrc", "_netrc", ".git-credentials", ".htpasswd", "credentials.json", "id_rsa", "id_ed25519"];

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
    for (const ext of [...SECRET_SHAPED_EXTENSIONS, ...SECRET_SHAPED_BASENAMES]) {
      assert.equal(TEXT_EXTENSIONS.has(ext), false, `${ext} must not be previewable/editable text`);
    }
  });

  it("and `isSensitivePath` refuses each of them, so the raw route cannot serve the bytes either", () => {
    // Absence from TEXT_EXTENSIONS stops the preview and the write gate and
    // nothing else: /api/files/raw streams whatever resolveSafe allows, and
    // the Files view now has a Download button pointed straight at it. The two
    // lists have to agree or the module header's claim is false.
    for (const ext of SECRET_SHAPED_EXTENSIONS) {
      assert.equal(isSensitivePath(`secrets${ext}`), true, `secrets${ext} must be refused by isSensitivePath`);
    }
    for (const base of SECRET_SHAPED_BASENAMES) {
      assert.equal(isSensitivePath(base), true, `${base} must be refused by isSensitivePath`);
      assert.equal(isSensitivePath(`sub/dir/${base}`), true, `sub/dir/${base} must be refused by isSensitivePath`);
    }
  });

  it("container formats that merely contain text", () => {
    for (const ext of [".xlsx", ".docx", ".pptx", ".zip", ".gz", ".tgz", ".kmz", ".svgz", ".usdz", ".epub"]) {
      assert.equal(TEXT_EXTENSIONS.has(ext), false, `${ext} is an archive, not text`);
    }
  });

  it("formats that are text only sometimes", () => {
    // `.sub` is the sharp one: MicroDVD `.sub` is text, but a `.sub` beside an
    // `.idx` is VobSub bitmap data, and there is no way to tell from the name.
    for (const ext of [".plist", ".rtf", ".sub"]) {
      assert.equal(TEXT_EXTENSIONS.has(ext), false, `${ext} cannot be assumed to be plain text`);
    }
  });

  it("the media extensions the other classifier branches own", () => {
    // classify() checks TEXT first, so an overlap here would silently win over
    // the image/audio/video branch and break a working preview. Read from the
    // real sets rather than a copy of them: a hand-kept list stops covering the
    // branch the moment someone adds an extension to it.
    const mediaExtensions = [...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ".pdf"];
    assert.ok(mediaExtensions.length > 20, "media sets look empty — the import is wrong, not the policy");
    for (const ext of mediaExtensions) {
      assert.equal(TEXT_EXTENSIONS.has(ext), false, `${ext} is claimed by another classify() branch`);
    }
  });
});

describe("TEXT_EXTENSIONS includes", () => {
  it("the subtitle family #3213 was reported against", () => {
    // `.sub` is absent on purpose — see the "text only sometimes" case above.
    for (const ext of [".srt", ".vtt", ".ass", ".ssa", ".sbv", ".lrc"]) {
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

describe("the write gate is narrower than the preview gate", () => {
  // `/api/files/*` is exempt from bearer auth, and the upload route already
  // refuses these because they are "things a later double-click would execute".
  // Typing the same bytes through create/PUT is the same capability, so the two
  // answers have to agree — while the file stays previewable, which is the
  // whole point of #3213.
  it("refuses every executable suffix the upload route refuses", () => {
    for (const ext of BLOCKED_UPLOAD_EXTENSIONS) {
      assert.equal(isWritableTextFile(`/ws/run${ext}`), false, `${ext} must not be writable through the file API`);
    }
  });

  it("still PREVIEWS the executable suffixes that are plain text", () => {
    for (const ext of [".sh", ".bat", ".cmd", ".ps1"]) {
      assert.ok(TEXT_EXTENSIONS.has(ext), `${ext} should still preview as text`);
    }
  });

  it("allows ordinary text files through", () => {
    for (const name of ["/ws/notes.md", "/ws/data.json", "/ws/talk.srt", "/ws/main.py"]) {
      assert.equal(isWritableTextFile(name), true, `${name} should be writable`);
    }
  });

  it("still refuses anything that is not text at all", () => {
    for (const name of ["/ws/photo.png", "/ws/archive.zip", "/ws/deck.pptx"]) {
      assert.equal(isWritableTextFile(name), false, `${name} should not be writable`);
    }
  });
});
