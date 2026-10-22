// Unit tests for the EXIF wrapper (#1222 PR-A).
//
// Exercises the projection logic against synthetic exifr outputs, so
// no JPEG fixture file is needed. The integration test under
// test/workspace/photo-locations/ covers the on-disk hook flow.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isExifSupportedMime, parsePhotoExif, projectExif } from "../../server/utils/exif.js";

const TAKEN_AT_RAW = new Date("2026-04-12T08:30:00.000Z");
const TAKEN_AT_ISO = TAKEN_AT_RAW.toISOString();

describe("isExifSupportedMime", () => {
  it("accepts every image MIME exifr can read", () => {
    for (const mime of ["image/jpeg", "image/png", "image/heic", "image/heif", "image/tiff", "image/webp"]) {
      assert.equal(isExifSupportedMime(mime), true, mime);
    }
  });

  // Codex review on PR #1247: `attachment-store.ts`'s `MIME_EXT` table
  // accepts BOTH `image/jpeg` and the legacy alias `image/jpg`, so an
  // upload labelled `image/jpg` saves successfully — but the original
  // allowlist rejected it, silently skipping EXIF capture for that
  // alias. Lock the alias parity in place with a test.
  it("accepts the image/jpg alias (parity with attachment-store MIME_EXT)", () => {
    assert.equal(isExifSupportedMime("image/jpg"), true);
    assert.equal(isExifSupportedMime("IMAGE/JPG"), true);
  });

  it("rejects non-image MIMEs", () => {
    for (const mime of ["application/pdf", "video/mp4", "text/plain", "application/octet-stream", "image/gif"]) {
      assert.equal(isExifSupportedMime(mime), false, mime);
    }
  });

  it("ignores casing", () => {
    assert.equal(isExifSupportedMime("IMAGE/JPEG"), true);
    assert.equal(isExifSupportedMime("Image/Heic"), true);
  });
});

describe("projectExif — happy paths", () => {
  it("plucks the full iPhone-style record", () => {
    const exif = projectExif({
      // Location
      latitude: 35.6586,
      longitude: 139.7454,
      GPSAltitude: 38.4,
      GPSHPositioningError: 4.5,
      GPSImgDirection: 273.5,
      GPSSpeed: 0,
      // Time
      DateTimeOriginal: TAKEN_AT_RAW,
      // Body + lens
      Make: "Apple",
      Model: "iPhone 15 Pro",
      LensModel: "iPhone 15 Pro back triple camera",
      Software: "Photos 5.0",
      // Exposure
      ExposureTime: 0.008333,
      FNumber: 1.78,
      ISO: 64,
      FocalLength: 6.765,
      FocalLengthIn35mmFormat: 24,
      Flash: 16, // not fired (bit 0 = 0)
      // Image
      ExifImageWidth: 4032,
      ExifImageHeight: 3024,
      Orientation: 1,
    });
    assert.deepEqual(exif, {
      lat: 35.6586,
      lng: 139.7454,
      altitude: 38.4,
      hPositioningError: 4.5,
      heading: 273.5,
      speed: 0,
      takenAt: TAKEN_AT_ISO,
      make: "Apple",
      model: "iPhone 15 Pro",
      lens: "iPhone 15 Pro back triple camera",
      software: "Photos 5.0",
      exposureTime: 0.008333,
      fNumber: 1.78,
      iso: 64,
      focalLength: 6.765,
      focalLength35mm: 24,
      flashFired: false,
      width: 4032,
      height: 3024,
      orientation: 1,
    });
  });

  it("keeps lat/lng even when other fields are missing", () => {
    const exif = projectExif({ latitude: 35.6586, longitude: 139.7454 });
    assert.deepEqual(exif, { lat: 35.6586, lng: 139.7454 });
  });

  it("keeps takenAt without GPS (typical scanned-document case)", () => {
    const exif = projectExif({ DateTimeOriginal: TAKEN_AT_RAW });
    assert.deepEqual(exif, { takenAt: TAKEN_AT_ISO });
  });
});

describe("projectExif — GPS extras (heading, speed, accuracy)", () => {
  it("rejects out-of-range heading", () => {
    const exif = projectExif({ GPSImgDirection: 720 });
    assert.equal(exif, null);
  });

  it("accepts the full 0..360 heading range", () => {
    assert.equal(projectExif({ GPSImgDirection: 0 })?.heading, 0);
    assert.equal(projectExif({ GPSImgDirection: 360 })?.heading, 360);
  });

  it("rejects negative positioning error / speed", () => {
    assert.equal(projectExif({ GPSHPositioningError: -1 }), null);
    assert.equal(projectExif({ GPSSpeed: -1 }), null);
  });
});

describe("projectExif — exposure fields", () => {
  it("plucks the four photographic basics + 35mm-equivalent", () => {
    const exif = projectExif({ ExposureTime: 0.004, FNumber: 2.8, ISO: 200, FocalLength: 50, FocalLengthIn35mmFormat: 75 });
    assert.deepEqual(exif, { exposureTime: 0.004, fNumber: 2.8, iso: 200, focalLength: 50, focalLength35mm: 75 });
  });

  it("derives flashFired from the raw EXIF Flash byte", () => {
    // Bit 0 = 1 → flash fired
    assert.equal(projectExif({ Flash: 1 })?.flashFired, true);
    // Bit 0 = 1 with red-eye flag (0x41) → still fired
    assert.equal(projectExif({ Flash: 0x41 })?.flashFired, true);
    // Bit 0 = 0 → did not fire
    assert.equal(projectExif({ Flash: 16 })?.flashFired, false);
    assert.equal(projectExif({ Flash: 0 })?.flashFired, false);
  });

  it("derives flashFired from a post-processed Flash object", () => {
    // exifr v7 with default options returns an object — we accept
    // both `fired` (older) and `flashfired` (newer) field names.
    assert.equal(projectExif({ Flash: { fired: true } })?.flashFired, true);
    assert.equal(projectExif({ Flash: { flashfired: false } })?.flashFired, false);
    // Object with neither known key falls through to undefined
    // → result has no `flashFired` field.
    assert.equal(projectExif({ Flash: { mode: "auto" } })?.flashFired, undefined);
  });
});

describe("projectExif — image dimensions", () => {
  it("prefers ExifImageWidth/Height over ImageWidth/Height", () => {
    const exif = projectExif({ ExifImageWidth: 4032, ExifImageHeight: 3024, ImageWidth: 1024, ImageHeight: 768 });
    assert.deepEqual(exif, { width: 4032, height: 3024 });
  });

  it("falls back to ImageWidth/Height when ExifImage* are missing", () => {
    const exif = projectExif({ ImageWidth: 1024, ImageHeight: 768 });
    assert.deepEqual(exif, { width: 1024, height: 768 });
  });

  it("rejects zero / negative dimensions", () => {
    assert.equal(projectExif({ ExifImageWidth: 0, ExifImageHeight: 100 }), null);
    assert.equal(projectExif({ ImageWidth: -1, ImageHeight: 100 }), null);
  });
});

describe("projectExif — date-field fallback chain", () => {
  it("falls back to CreateDate when DateTimeOriginal is missing", () => {
    const exif = projectExif({ CreateDate: TAKEN_AT_RAW });
    assert.equal(exif?.takenAt, TAKEN_AT_ISO);
  });

  it("falls back to DateTime when CreateDate is missing too", () => {
    const exif = projectExif({ DateTime: TAKEN_AT_RAW });
    assert.equal(exif?.takenAt, TAKEN_AT_ISO);
  });

  it("ignores invalid Date objects", () => {
    const exif = projectExif({ DateTimeOriginal: new Date("invalid") });
    assert.equal(exif, null);
  });

  it("ignores plain-string date fields (exifr pre-coerces; bare strings mean parse failure)", () => {
    const exif = projectExif({ DateTimeOriginal: "2026:04:12 08:30:00" });
    assert.equal(exif, null);
  });
});

describe("projectExif — coordinate validation", () => {
  it("rejects out-of-range latitude", () => {
    const exif = projectExif({ latitude: 91, longitude: 0 });
    assert.equal(exif, null);
  });

  it("rejects out-of-range longitude", () => {
    const exif = projectExif({ latitude: 0, longitude: -181 });
    assert.equal(exif, null);
  });

  it("rejects exact 0/0 (Atlantic null-island)", () => {
    const exif = projectExif({ latitude: 0, longitude: 0 });
    assert.equal(exif, null);
  });

  it("accepts 0/0-adjacent legitimate coords", () => {
    const exif = projectExif({ latitude: 0, longitude: 0.001 });
    assert.deepEqual(exif, { lat: 0, lng: 0.001 });
  });

  it("rejects non-numeric coords (string lat from a malformed parse)", () => {
    const exif = projectExif({ latitude: "35.6586" as unknown as number, longitude: 139.7454 });
    assert.equal(exif, null);
  });

  it("rejects only one of lat / lng (never half a fix)", () => {
    const exif = projectExif({ latitude: 35.6586 });
    assert.equal(exif, null);
  });

  it("rejects NaN / Infinity coords", () => {
    assert.equal(projectExif({ latitude: NaN, longitude: 0 }), null);
    assert.equal(projectExif({ latitude: 0, longitude: Number.POSITIVE_INFINITY }), null);
  });
});

describe("projectExif — orientation guard", () => {
  it("accepts orientation 1-8", () => {
    for (let i = 1; i <= 8; i++) {
      const exif = projectExif({ DateTimeOriginal: TAKEN_AT_RAW, Orientation: i });
      assert.equal(exif?.orientation, i);
    }
  });

  it("rejects out-of-range orientation", () => {
    const exif = projectExif({ DateTimeOriginal: TAKEN_AT_RAW, Orientation: 9 });
    assert.equal(exif?.orientation, undefined);
  });
});

describe("projectExif — empty / null returns", () => {
  it("returns null when no useful fields are present", () => {
    assert.equal(projectExif({}), null);
  });

  it("returns null when only ignored fields are present", () => {
    // ColorSpace / MeteringMode / WhiteBalance are EXIF tags we
    // deliberately drop — neither in the projected shape nor in any
    // helper. A record with only these should yield null.
    assert.equal(projectExif({ ColorSpace: 1, MeteringMode: 2, WhiteBalance: 0 }), null);
  });

  it("ignores empty-string camera fields", () => {
    assert.equal(projectExif({ Make: "", Model: "" }), null);
  });
});

describe("parsePhotoExif — parser injection", () => {
  it("returns null when the parser throws (corrupt JPEG)", async () => {
    const result = await parsePhotoExif(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]), () => Promise.reject(new Error("malformed")));
    assert.equal(result, null);
  });

  it("returns null when the parser yields no useful fields", async () => {
    assert.equal(await parsePhotoExif(Buffer.from([0xff, 0xd8]), () => Promise.resolve({})), null);
  });

  it("returns null for bytes the real parser finds no EXIF in", async () => {
    assert.equal(await parsePhotoExif(Buffer.from("not a photo")), null);
  });

  it("flows the parser output through projectExif", async () => {
    const result = await parsePhotoExif(Buffer.from([0xff, 0xd8]), () => Promise.resolve({ latitude: 35.6586, longitude: 139.7454, Make: "Apple" }));
    assert.deepEqual(result, { lat: 35.6586, lng: 139.7454, make: "Apple" });
  });
});
