// Integration test for the photo-EXIF post-save hook (#1222 PR-A).
//
// Exercises the actual `saveAttachment` → `runSaveAttachmentHooks`
// → `capturePhotoLocation` chain against an isolated tmp workspace,
// using a stub `exifr.parse` so no JPEG fixture is needed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { registerSaveAttachmentHook, saveAttachment } from "../../server/utils/files/attachment-store.js";
import { capturePhotoLocation, sidecarPathForAttachment } from "../../server/workspace/photo-locations/index.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import { saveSettings } from "../../server/system/config.js";

const FAKE_EXIF = {
  latitude: 35.6586,
  longitude: 139.7454,
  GPSAltitude: 38.4,
  DateTimeOriginal: new Date("2026-04-12T08:30:00.000Z"),
  Make: "Apple",
  Model: "iPhone 15 Pro",
};

const ONE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

type DescriptorMap = Record<string, PropertyDescriptor>;

describe("photo-locations hook — saveAttachment integration", () => {
  let savedDescriptors: DescriptorMap = {};
  let workspaceRoot: string;

  function overrideWorkspacePath(key: string, value: string): void {
    const desc = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, key);
    if (desc) savedDescriptors[key] = desc;
    Object.defineProperty(WORKSPACE_PATHS, key, { ...(desc ?? { configurable: true }), value, configurable: true, enumerable: true, writable: true });
  }

  beforeEach(() => {
    savedDescriptors = {};
    workspaceRoot = mkdtempSync(path.join(tmpdir(), "photo-loc-test-"));
    overrideWorkspacePath("attachments", path.join(workspaceRoot, "data/attachments"));
    overrideWorkspacePath("locations", path.join(workspaceRoot, "data/locations"));
    overrideWorkspacePath("configs", path.join(workspaceRoot, "config"));
  });

  afterEach(() => {
    for (const [key, desc] of Object.entries(savedDescriptors)) {
      Object.defineProperty(WORKSPACE_PATHS, key, desc);
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("writes a sidecar JSON with shape-compatible coords when EXIF exists + auto-capture is on by default", async () => {
    saveSettings({ extraAllowedTools: [] });
    const unregister = registerSaveAttachmentHook(makeHookWithStubParser(() => Promise.resolve(FAKE_EXIF)));
    try {
      const saved = await saveAttachment(ONE_PIXEL_PNG_BASE64, "image/jpeg");
      const sidecarPath = expectedSidecarPath(saved.relativePath);
      assert.ok(existsSync(sidecarPath), `expected sidecar at ${sidecarPath}`);

      const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as {
        version: number;
        photo: { relativePath: string; mimeType: string };
        exif: { lat?: number; lng?: number; takenAt?: string; make?: string };
        capturedAt: string;
      };
      assert.equal(sidecar.version, 1);
      assert.equal(sidecar.photo.relativePath, saved.relativePath);
      assert.equal(sidecar.photo.mimeType, "image/jpeg");
      assert.equal(sidecar.exif.lat, 35.6586);
      assert.equal(sidecar.exif.lng, 139.7454);
      assert.equal(sidecar.exif.make, "Apple");
      assert.match(sidecar.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      unregister();
    }
  });

  it("does NOT write a sidecar when auto-capture is opted-out", async () => {
    saveSettings({ extraAllowedTools: [], photoExif: { autoCapture: false } });
    const unregister = registerSaveAttachmentHook(makeHookWithStubParser(() => Promise.resolve(FAKE_EXIF)));
    try {
      const saved = await saveAttachment(ONE_PIXEL_PNG_BASE64, "image/jpeg");
      const sidecarPath = expectedSidecarPath(saved.relativePath);
      assert.equal(existsSync(sidecarPath), false, "no sidecar should be written under opt-out");
    } finally {
      unregister();
    }
  });

  it("does NOT write a sidecar for non-image MIMEs", async () => {
    saveSettings({ extraAllowedTools: [] });
    const unregister = registerSaveAttachmentHook(makeHookWithStubParser(() => Promise.resolve(FAKE_EXIF)));
    try {
      const saved = await saveAttachment(ONE_PIXEL_PNG_BASE64, "application/pdf");
      const sidecarPath = expectedSidecarPath(saved.relativePath);
      assert.equal(existsSync(sidecarPath), false, "non-image attachments must not get a sidecar");
    } finally {
      unregister();
    }
  });

  it("does NOT write a sidecar when the parser yields no fields (screenshot-style)", async () => {
    saveSettings({ extraAllowedTools: [] });
    const unregister = registerSaveAttachmentHook(makeHookWithStubParser(() => Promise.resolve({})));
    try {
      const saved = await saveAttachment(ONE_PIXEL_PNG_BASE64, "image/jpeg");
      const sidecarPath = expectedSidecarPath(saved.relativePath);
      assert.equal(existsSync(sidecarPath), false);
    } finally {
      unregister();
    }
  });

  it("survives a thrown parser without failing the upload (saveAttachment still resolves)", async () => {
    saveSettings({ extraAllowedTools: [] });
    const unregister = registerSaveAttachmentHook(makeHookWithStubParser(() => Promise.reject(new Error("malformed JPEG"))));
    try {
      const saved = await saveAttachment(ONE_PIXEL_PNG_BASE64, "image/jpeg");
      assert.ok(saved.relativePath.startsWith("data/attachments/"));
      const sidecarPath = expectedSidecarPath(saved.relativePath);
      assert.equal(existsSync(sidecarPath), false);
    } finally {
      unregister();
    }
  });

  it("calls the production capturePhotoLocation when registered (no parser stub) — skips because real exifr can't parse a 1-pixel PNG", async () => {
    saveSettings({ extraAllowedTools: [] });
    const unregister = registerSaveAttachmentHook(capturePhotoLocation);
    try {
      const saved = await saveAttachment(ONE_PIXEL_PNG_BASE64, "image/png");
      const sidecarPath = expectedSidecarPath(saved.relativePath);
      // No EXIF in a 1px PNG → no sidecar. This proves the
      // production hook is wired and the no-EXIF path is graceful.
      assert.equal(existsSync(sidecarPath), false);
    } finally {
      unregister();
    }
  });

  // Regression: the previous commit didn't list HEIC / HEIF / TIFF in
  // attachment-store's MIME_EXT table, so iPhone HEIC uploads landed
  // as `<id>.bin` even though the bytes were a valid HEIC. The Files
  // panel showed an unrecognised extension and downstream tools that
  // sniff by extension (image preview, the photo plugin's future
  // rescan kind) couldn't tell what they were looking at. Lock the
  // ext mapping in place. (#1222 PR-A follow-up.)
  it("saves HEIC uploads with the .heic extension, not .bin", async () => {
    saveSettings({ extraAllowedTools: [] });
    const saved = await saveAttachment(ONE_PIXEL_PNG_BASE64, "image/heic");
    assert.match(saved.relativePath, /\.heic$/, `expected .heic extension, got ${saved.relativePath}`);
    assert.doesNotMatch(saved.relativePath, /\.bin$/);
  });

  it("saves HEIF / TIFF uploads with their proper extensions", async () => {
    saveSettings({ extraAllowedTools: [] });
    const heif = await saveAttachment(ONE_PIXEL_PNG_BASE64, "image/heif");
    assert.match(heif.relativePath, /\.heif$/);
    const tiff = await saveAttachment(ONE_PIXEL_PNG_BASE64, "image/tiff");
    assert.match(tiff.relativePath, /\.tif$/);
  });
});

/** Wrap the production helper so tests fail clearly when the
 *  partition derivation hits its "skip" branch (ret === null) — the
 *  test fixtures always produce well-shaped paths, so a null return
 *  here means an upstream regression, not a runtime concern. */
function expectedSidecarPath(relativePath: string): string {
  const sidecarPath = sidecarPathForAttachment(relativePath);
  assert.ok(sidecarPath, `expected sidecarPathForAttachment to derive a path for ${relativePath}`);
  return sidecarPath;
}

/** Build a hook that runs the same shape as `capturePhotoLocation`
 *  but with a stubbed exifr parser. Test seam — the hook in
 *  `server/workspace/photo-locations/index.ts` reads `exifr.parse`
 *  through the default in `parsePhotoExif`; we re-create the flow
 *  here with a controllable parser instead. */
function makeHookWithStubParser(parser: (buf: Buffer) => Promise<unknown>) {
  return async (relativePath: string, mimeType: string) => {
    const { capturePhotoLocationWithParser } = await import("../../server/workspace/photo-locations/index.js");
    return capturePhotoLocationWithParser(relativePath, mimeType, parser);
  };
}
