import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { saveAttachment } from "../../server/utils/files/attachment-store.js";
import { capturePhotoLocationWithParser, sidecarPathForAttachment } from "../../server/workspace/photo-locations/index.js";
import { listAllSidecars } from "../../server/workspace/photo-locations/list.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import { saveSettings } from "../../server/system/config.js";

const GPS_EXIF = { latitude: 35.6586, longitude: 139.7454 };
const PHOTO_BASE64 = Buffer.from("photo").toString("base64");
const SIDECAR_MODE = 0o600;
const PERMISSION_BITS = 0o777;
const PLANTED = {
  version: 1,
  capturedAt: "2020-01-01T00:00:00.000Z",
  photo: { relativePath: "outside.jpg", mimeType: "image/jpeg" },
  exif: { lat: 1, lng: 2 },
};

let workspace: string;
let outside: string;
let savedDescriptors: Record<string, PropertyDescriptor>;
const parsedBytes: string[] = [];
const parser = (buf: Buffer): Promise<unknown> => {
  parsedBytes.push(buf.toString());
  return Promise.resolve(GPS_EXIF);
};

function overrideWorkspacePath(key: string, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, key);
  if (desc) savedDescriptors[key] = desc;
  Object.defineProperty(WORKSPACE_PATHS, key, { value, configurable: true, enumerable: true, writable: true });
}

const locationsDir = (): string => path.join(workspace, "data", "locations");
const listedPaths = async (): Promise<string[]> => (await listAllSidecars()).map((row) => row.relativePath);

describe("photo locations stay inside the workspace", () => {
  beforeEach(() => {
    savedDescriptors = {};
    parsedBytes.length = 0;
    workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "photo-loc-ws-")));
    outside = realpathSync(mkdtempSync(path.join(tmpdir(), "photo-loc-out-")));
    overrideWorkspacePath("attachments", path.join(workspace, "data/attachments"));
    overrideWorkspacePath("locations", locationsDir());
    overrideWorkspacePath("configs", path.join(workspace, "config"));
    saveSettings({ extraAllowedTools: [] });
  });

  afterEach(() => {
    Object.entries(savedDescriptors).forEach(([key, desc]) => Object.defineProperty(WORKSPACE_PATHS, key, desc));
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("writes the sidecar from the stored photo, private, and lists it", async () => {
    const saved = await saveAttachment(PHOTO_BASE64, "image/jpeg");
    await capturePhotoLocationWithParser(saved.relativePath, "image/jpeg", parser);
    assert.deepEqual(parsedBytes, ["photo"]);
    const sidecarPath = sidecarPathForAttachment(saved.relativePath);
    assert.ok(sidecarPath);
    assert.equal(JSON.parse(readFileSync(sidecarPath, "utf8")).exif.lat, GPS_EXIF.latitude);
    if (process.platform !== "win32") assert.equal(statSync(sidecarPath).mode & PERMISSION_BITS, SIDECAR_MODE);
    const sidecarName = path.posix.basename(saved.relativePath).replace(/\.[^.]+$/, ".json");
    assert.deepEqual(await listedPaths(), [
      path.posix.join("data/locations", path.posix.dirname(saved.relativePath).split("/").slice(2).join("/"), sidecarName),
    ]);
  });

  it("writes and lists nothing when the locations folder is a link out", async () => {
    const saved = await saveAttachment(PHOTO_BASE64, "image/jpeg");
    mkdirSync(path.join(outside, "2020", "01"), { recursive: true });
    writeFileSync(path.join(outside, "2020", "01", "planted.json"), JSON.stringify(PLANTED));
    mkdirSync(path.dirname(locationsDir()), { recursive: true });
    symlinkSync(outside, locationsDir(), "dir");
    await capturePhotoLocationWithParser(saved.relativePath, "image/jpeg", parser);
    assert.deepEqual(readdirSync(outside), ["2020"]);
    assert.deepEqual(await listedPaths(), []);
  });

  it("does not list a sidecar that is a link out", async () => {
    writeFileSync(path.join(outside, "planted.json"), JSON.stringify(PLANTED));
    mkdirSync(path.join(locationsDir(), "2020", "01"), { recursive: true });
    symlinkSync(path.join(outside, "planted.json"), path.join(locationsDir(), "2020", "01", "planted.json"));
    assert.deepEqual(await listedPaths(), []);
  });

  it("reads no photo when the attachment partition became a link out", async () => {
    const saved = await saveAttachment(PHOTO_BASE64, "image/jpeg");
    const partition = path.join(workspace, path.dirname(saved.relativePath));
    renameSync(partition, path.join(outside, "partition"));
    writeFileSync(path.join(outside, "partition", path.basename(saved.relativePath)), "outside photo");
    symlinkSync(path.join(outside, "partition"), partition, "dir");
    await capturePhotoLocationWithParser(saved.relativePath, "image/jpeg", parser);
    assert.deepEqual(parsedBytes, []);
    assert.deepEqual(await listedPaths(), []);
  });
});
