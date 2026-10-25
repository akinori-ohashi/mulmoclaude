import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { artifactMount, artifactScope, readArtifactFile, sendArtifactFile } from "../../../server/utils/files/artifactMount.js";
import { chooseByteRange, preconditionFailed, rangeApplies, type ParsedRange } from "../../../server/utils/files/sendFileHandle.js";

const BODY = "0123456789";
const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "artifact-mount-ws-")));
const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "artifact-mount-out-")));
const images = path.join(workspace, "artifacts", "images");
let server: http.Server;
let baseUrl = "";

const get = (urlPath: string, headers: Record<string, string> = {}, method = "GET"): Promise<Response> => fetch(`${baseUrl}${urlPath}`, { method, headers });

// fetch adds `Cache-Control: no-cache` to a conditional request, which makes any server answer 200.
const conditionalStatus = (urlPath: string, headers: Record<string, string>): Promise<number> =>
  new Promise((resolve, reject) => {
    http
      .get(`${baseUrl}${urlPath}`, { headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on("error", reject);
  });

/** Swap `dir` for a link to `target` for the duration of `body`. */
async function withLinkedDir(dir: string, target: string, body: () => Promise<void>): Promise<void> {
  renameSync(dir, `${dir}-real`);
  symlinkSync(target, dir);
  try {
    await body();
  } finally {
    unlinkSync(dir);
    renameSync(`${dir}-real`, dir);
  }
}

describe("artifactMount", () => {
  before(async () => {
    mkdirSync(path.join(images, "sub"), { recursive: true });
    mkdirSync(path.join(images, "dir.png"));
    mkdirSync(path.join(outside, "artifacts", "images"), { recursive: true });
    writeFileSync(path.join(images, "a.png"), BODY);
    writeFileSync(path.join(images, "empty.png"), "");
    writeFileSync(path.join(images, "a.txt"), "text");
    writeFileSync(path.join(images, "sub", "b.png"), "nested");
    writeFileSync(path.join(images, ".hidden.png"), "hidden");
    writeFileSync(path.join(outside, "secret.png"), "secret");
    writeFileSync(path.join(outside, "artifacts", "images", "secret.png"), "secret");
    symlinkSync(path.join(outside, "secret.png"), path.join(images, "link-out.png"));
    const app = express();
    app.use("/images", artifactMount(workspace, "artifacts/images", /\.(png|svg)$/i));
    app.use("/missing", artifactMount(workspace, "artifacts/none", /\.png$/i));
    app.use(
      "/typed",
      artifactMount(workspace, "artifacts/images", /\.png$/i, async (req, res, scope, relPath) => {
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        await sendArtifactFile(req, res, scope, relPath);
      }),
    );
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("serves an in-scope file with entity headers", async () => {
    const res = await get("/images/a.png");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), BODY);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("content-length"), String(BODY.length));
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.ok(res.headers.get("etag"));
    assert.ok(res.headers.get("last-modified"));
    assert.equal(await (await get("/images/sub/b.png")).text(), "nested");
  });

  it("answers HEAD with headers only and an empty file with an empty body", async () => {
    const head = await get("/images/a.png", {}, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(BODY.length));
    assert.equal(await head.text(), "");
    const empty = await get("/images/empty.png");
    assert.equal(empty.status, 200);
    assert.equal(await empty.text(), "");
  });

  it("serves one byte range, refuses an unsatisfiable one, and sends the whole file for several", async () => {
    const partial = await get("/images/a.png", { Range: "bytes=2-4" });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), "234");
    assert.equal(partial.headers.get("content-range"), `bytes 2-4/${BODY.length}`);
    const unsatisfiable = await get("/images/a.png", { Range: "bytes=20-" });
    assert.equal(unsatisfiable.status, 416);
    assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${BODY.length}`);
    const otherUnit = await get("/images/a.png", { Range: "items=0-3" });
    assert.equal(otherUnit.status, 200);
    assert.equal(await otherUnit.text(), BODY);
    const several = await get("/images/a.png", { Range: "bytes=0-1,5-6" });
    assert.equal(several.status, 200);
    assert.equal(await several.text(), BODY);
  });

  it("answers conditional requests as send does: 304, 412, and a Range only when If-Range is current", async () => {
    const etag = (await get("/images/a.png")).headers.get("etag") ?? "";
    assert.equal(await conditionalStatus("/images/a.png", { "If-None-Match": etag }), 304);
    const stale = await get("/images/a.png", { Range: "bytes=2-4", "If-Range": 'W/"stale"' });
    assert.equal(stale.status, 200);
    assert.equal(await stale.text(), BODY);
    assert.equal((await get("/images/a.png", { Range: "bytes=2-4", "If-Range": etag })).status, 206);
    const lastModified = (await get("/images/a.png")).headers.get("last-modified") ?? "";
    assert.equal((await get("/images/a.png", { Range: "bytes=2-4", "If-Range": lastModified })).status, 206);
    assert.equal(await conditionalStatus("/images/a.png", { "If-Match": '"stale"' }), 412);
    assert.equal(await conditionalStatus("/images/a.png", { "If-Unmodified-Since": "Thu, 01 Jan 1970 00:00:00 GMT" }), 412);
  });

  it("keeps a Content-Type the responder set", async () => {
    const res = await get("/typed/a.png");
    assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    assert.equal(await res.text(), BODY);
  });

  it("is a 404 for missing, dotfile, directory, traversal, malformed and disallowed requests", async () => {
    const paths = ["/images/none.png", "/images/.hidden.png", "/images/dir.png", "/images/..%2F..%2F..%2Fsecret.png", "/images/%ZZ.png", "/images/a.txt"];
    const statuses = await Promise.all(paths.map(async (urlPath) => (await get(urlPath)).status));
    assert.deepEqual(
      statuses,
      paths.map(() => 404),
    );
  });

  it("does not follow a file link out of the scope", async () => {
    const res = await get("/images/link-out.png");
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "");
  });

  it("is a 404 when the mount folder is a link out of the workspace", async () => {
    await withLinkedDir(images, outside, async () => {
      assert.equal((await get("/images/secret.png")).status, 404);
    });
  });

  it("is a 404 when artifacts/ itself is a link out of the workspace", async () => {
    await withLinkedDir(path.join(workspace, "artifacts"), path.join(outside, "artifacts"), async () => {
      assert.equal((await get("/images/secret.png")).status, 404);
    });
  });

  it("is a 404 when the mount folder does not exist", async () => {
    assert.equal((await get("/missing/a.png")).status, 404);
  });
});

describe("readArtifactFile", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "artifact-read-ws-")));
  const away = realpathSync(mkdtempSync(path.join(tmpdir(), "artifact-read-out-")));
  before(() => {
    mkdirSync(path.join(root, "docs", "dir"), { recursive: true });
    writeFileSync(path.join(root, "docs", "a.txt"), "in scope");
    writeFileSync(path.join(root, "top.txt"), "workspace file");
    writeFileSync(path.join(away, "secret.txt"), "secret");
    symlinkSync(path.join(away, "secret.txt"), path.join(root, "docs", "link-out.txt"));
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  });

  const read = async (mountDir: string, relPath: string): Promise<string | null> => {
    const scope = await artifactScope(root, mountDir);
    assert.ok(scope);
    const bytes = await readArtifactFile(scope, relPath);
    return bytes === null ? null : bytes.toString("utf8");
  };

  it("reads a regular file of a folder scope, and of the workspace itself under the empty scope", async () => {
    assert.equal(await read("docs", "a.txt"), "in scope");
    assert.equal(await read("", "top.txt"), "workspace file");
    assert.equal(await read("", path.join("docs", "a.txt")), "in scope");
  });

  it("is null for a missing file, a directory, an escape and a file link out", async () => {
    assert.equal(await read("docs", "none.txt"), null);
    assert.equal(await read("docs", "dir"), null);
    assert.equal(await read("docs", "../top.txt"), null);
    assert.equal(await read("", "../secret.txt"), null);
    assert.equal(await read("docs", "link-out.txt"), null);
  });
});

describe("chooseByteRange", () => {
  it("takes exactly one range and treats the rest as the whole file", () => {
    assert.deepEqual(chooseByteRange([{ start: 1, end: 2 }]), { kind: "part", range: { start: 1, end: 2 } });
    assert.deepEqual(chooseByteRange(-1), { kind: "unsatisfiable" });
    const wholes: ParsedRange[] = [
      -2,
      undefined,
      [],
      [
        { start: 0, end: 1 },
        { start: 5, end: 6 },
      ],
    ];
    wholes.forEach((parsed) => assert.deepEqual(chooseByteRange(parsed), { kind: "whole" }));
  });
});

const VALIDATORS = { etag: 'W/"a-1"', lastModified: "Thu, 22 Oct 2026 06:00:00 GMT" };

describe("rangeApplies", () => {
  it("honours a Range without If-Range, or when If-Range names the entity tag or a date no older than it", () => {
    assert.equal(rangeApplies(undefined, VALIDATORS), true);
    assert.equal(rangeApplies("", VALIDATORS), true);
    assert.equal(rangeApplies('W/"a-1"', VALIDATORS), true);
    assert.equal(rangeApplies(VALIDATORS.lastModified, VALIDATORS), true);
    assert.equal(rangeApplies("Fri, 23 Oct 2026 00:00:00 GMT", VALIDATORS), true);
    assert.equal(rangeApplies('W/"b-2"', VALIDATORS), false);
    assert.equal(rangeApplies("Wed, 21 Oct 2026 00:00:00 GMT", VALIDATORS), false);
    assert.equal(rangeApplies("not a date", VALIDATORS), false);
  });
});

describe("preconditionFailed", () => {
  it("fails an If-Match naming no current tag, and an If-Unmodified-Since older than the file", () => {
    assert.equal(preconditionFailed(undefined, undefined, VALIDATORS), false);
    assert.equal(preconditionFailed("*", undefined, VALIDATORS), false);
    assert.equal(preconditionFailed('"x", W/"a-1"', undefined, VALIDATORS), false);
    assert.equal(preconditionFailed('"a-1"', undefined, VALIDATORS), false);
    assert.equal(preconditionFailed('"b-2"', undefined, VALIDATORS), true);
    assert.equal(preconditionFailed(undefined, VALIDATORS.lastModified, VALIDATORS), false);
    assert.equal(preconditionFailed(undefined, "Wed, 21 Oct 2026 00:00:00 GMT", VALIDATORS), true);
    assert.equal(preconditionFailed(undefined, "not a date", VALIDATORS), false);
  });
});
