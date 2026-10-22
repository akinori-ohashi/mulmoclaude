// Regression test for #1744 / #1754. `saveCompanion()` used to call a
// read-time confinement helper (`resolveWithinRoot` → `realpathSync`)
// on the not-yet-written companion path. `realpathSync` ENOENT
// collapsed to `null` and the caller mis-reported it as a traversal
// rejection, so every PPTX upload broke on hosts with LibreOffice /
// Docker sandbox available. The fix routes companion writes through
// `resolveWriteWithinRoot`, which mkdir-p's the parent and only
// realpath-checks the parent dir — not the leaf about to be created.

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, mkdir, symlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-attachment-test-"));
  process.env.MULMOCLAUDE_WORKSPACE_PATH = workspaceRoot;
});

after(async () => {
  if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
});

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const FAKE_PPTX_B64 = Buffer.from("not-a-real-pptx").toString("base64");
const FAKE_PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

describe("saveCompanion", () => {
  let original: { relativePath: string; mimeType: string };

  beforeEach(async () => {
    const { saveAttachment } = await import("../../../server/utils/files/attachment-store.ts");
    original = await saveAttachment(FAKE_PPTX_B64, PPTX_MIME);
  });

  it("writes the companion under the same partition + id as the original", async () => {
    const { saveCompanion } = await import("../../../server/utils/files/attachment-store.ts");
    const pdfPath = await saveCompanion(original.relativePath, FAKE_PDF, ".pdf");

    const dirOrig = path.posix.dirname(original.relativePath);
    const idOrig = path.posix.basename(original.relativePath, path.posix.extname(original.relativePath));
    assert.equal(path.posix.dirname(pdfPath), dirOrig, "companion shares the partition dir");
    assert.equal(path.posix.basename(pdfPath, ".pdf"), idOrig, "companion shares the id prefix");
    const stats = await stat(path.join(workspaceRoot, pdfPath));
    assert.ok(stats.isFile(), "companion file exists on disk");
  });

  it("rejects a `..` traversal segment", async () => {
    const { saveCompanion } = await import("../../../server/utils/files/attachment-store.ts");
    // Leading `..` survives path.posix.join normalization inside
    // saveCompanion (interior `..` gets collapsed harmlessly to a path
    // still inside root). Leading `..` is the actual escape vector.
    await assert.rejects(() => saveCompanion("../etc/secrets.pptx", FAKE_PDF, ".pdf"), /path traversal rejected/);
  });

  it("rejects an absolute path", async () => {
    const { saveCompanion } = await import("../../../server/utils/files/attachment-store.ts");
    await assert.rejects(() => saveCompanion("/etc/passwd.pptx", FAKE_PDF, ".pdf"), /path traversal rejected/);
  });

  it("rejects a NUL byte in the path", async () => {
    const { saveCompanion } = await import("../../../server/utils/files/attachment-store.ts");
    await assert.rejects(() => saveCompanion("data/attachments/2026/06/abc\0.pptx", FAKE_PDF, ".pdf"), /path traversal rejected/);
  });
});

describe("saveCompanion symlink escape", () => {
  // Point a partition dir at an outside-of-root target via symlink.
  // The write-time helper realpath-checks the parent, so the symlink
  // escape must be rejected before the bytes are written.
  let escapeTarget: string;

  beforeEach(async () => {
    escapeTarget = await mkdtemp(path.join(tmpdir(), "mulmoclaude-escape-"));
  });

  afterEach(async () => {
    await rm(escapeTarget, { recursive: true, force: true });
  });

  it("rejects a partition whose realpath escapes the attachments root", async () => {
    const { saveCompanion } = await import("../../../server/utils/files/attachment-store.ts");
    const attachmentsRoot = path.join(workspaceRoot, "data", "attachments");
    await mkdir(attachmentsRoot, { recursive: true });
    const escapePartition = path.join(attachmentsRoot, "9999", "99");
    await mkdir(path.dirname(escapePartition), { recursive: true });
    await symlink(escapeTarget, escapePartition, "dir");

    await assert.rejects(
      () => saveCompanion("data/attachments/9999/99/<id>.pptx", FAKE_PDF, ".pdf"),
      /refusing to write outside the scope/,
      "symlinked partition that escapes root must be rejected",
    );
  });
});

describe("loadAttachmentBase64 / loadAttachmentBytes", () => {
  it("round-trips the bytes that saveAttachment wrote", async () => {
    const { saveAttachment, loadAttachmentBase64, loadAttachmentBytes } = await import("../../../server/utils/files/attachment-store.ts");
    const saved = await saveAttachment(FAKE_PPTX_B64, PPTX_MIME);
    assert.equal(await loadAttachmentBase64(saved.relativePath), FAKE_PPTX_B64);
    assert.deepEqual(await loadAttachmentBytes(saved.relativePath), Buffer.from(FAKE_PPTX_B64, "base64"));
  });

  it("rejects reads of paths that do not exist", async () => {
    const { loadAttachmentBytes } = await import("../../../server/utils/files/attachment-store.ts");
    await assert.rejects(() => loadAttachmentBytes("data/attachments/0000/00/missing.pdf"), /path traversal rejected/);
  });

  // Defense-in-depth: even though the data file exists, a traversal-shaped
  // input string never reaches the file system because the read-time
  // helper rejects empty / `.` / `..` segments via path.normalize +
  // realpath-boundary check.
  it("rejects reads of traversal-shaped paths", async () => {
    const { loadAttachmentBytes } = await import("../../../server/utils/files/attachment-store.ts");
    await assert.rejects(() => loadAttachmentBytes("data/attachments/../README.md"), /path traversal rejected/);
  });

  it("can read back a companion produced by saveCompanion", async () => {
    const { saveAttachment, saveCompanion, loadAttachmentBytes } = await import("../../../server/utils/files/attachment-store.ts");
    const orig = await saveAttachment(FAKE_PPTX_B64, PPTX_MIME);
    const pdfPath = await saveCompanion(orig.relativePath, FAKE_PDF, ".pdf");
    assert.deepEqual(await loadAttachmentBytes(pdfPath), FAKE_PDF);
  });
});
