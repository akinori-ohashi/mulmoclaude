import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm, symlink } from "fs/promises";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import path from "path";
import JSZip from "jszip";
import { resolveWorkspacePath } from "../../../server/utils/files/workspace-io.js";
import { packHtmlBundle, zipBundle, packHtmlZip, type PackedBundle, type PackedFile } from "../../../server/utils/share/packHtml.js";

const TOKEN = "__share_pack_test__";
const HTML_REL = `artifacts/html/${TOKEN}/page.html`;
const IMG_REL = `artifacts/images/${TOKEN}/foo.png`;
const IMG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const htmlAbsDir = path.dirname(resolveWorkspacePath(HTML_REL));
const imgAbsDir = path.dirname(resolveWorkspacePath(IMG_REL));

const HTML = [
  `<!DOCTYPE html><html><head></head><body>`,
  `<img src="../../images/${TOKEN}/foo.png">`,
  `<img src="https://cdn.example/remote.png">`,
  `<img src="../../images/${TOKEN}/missing.png">`,
  `<img src="../../../../../../../../etc/passwd">`,
  `<img src="../../images/${TOKEN}/link-out.png">`,
  `<img src="../../images/${TOKEN}/pipe.png">`,
  `</body></html>`,
].join("");

function fileIn(bundle: PackedBundle, bundlePath: string): PackedFile {
  const found = bundle.files.find((file) => file.bundlePath === bundlePath);
  assert.ok(found, `${bundlePath} present`);
  return found;
}

const isWindows = process.platform === "win32";
let outsideDir = "";

before(async () => {
  await rm(imgAbsDir, { recursive: true, force: true });
  await mkdir(htmlAbsDir, { recursive: true });
  await mkdir(imgAbsDir, { recursive: true });
  await writeFile(resolveWorkspacePath(HTML_REL), HTML, "utf-8");
  await writeFile(resolveWorkspacePath(IMG_REL), IMG_BYTES);
  outsideDir = await mkdtemp(path.join(tmpdir(), "share-pack-outside-"));
  await writeFile(path.join(outsideDir, "secret.png"), "secret");
  if (isWindows) return;
  await symlink(path.join(outsideDir, "secret.png"), path.join(imgAbsDir, "link-out.png"));
  execFileSync("mkfifo", [path.join(imgAbsDir, "pipe.png")]);
});

after(async () => {
  await rm(htmlAbsDir, { recursive: true, force: true });
  await rm(imgAbsDir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

describe("packHtmlBundle", () => {
  it("bundles index.html + a present local asset, rewriting the path", async () => {
    const bundle = await packHtmlBundle(HTML_REL);
    assert.match(fileIn(bundle, "index.html").bytes.toString("utf-8"), /src="assets\/foo\.png"/);
    assert.deepEqual(fileIn(bundle, "assets/foo.png").bytes, IMG_BYTES);
  });

  it("keeps remote refs in the html but bundles no file for them", async () => {
    const bundle = await packHtmlBundle(HTML_REL);
    assert.match(fileIn(bundle, "index.html").bytes.toString("utf-8"), /https:\/\/cdn\.example\/remote\.png/);
  });

  it("skips a missing asset (no bundle file)", async () => {
    const bundle = await packHtmlBundle(HTML_REL);
    assert.equal(
      bundle.files.some((file) => file.bundlePath === "assets/missing.png"),
      false,
    );
  });

  it("skips a traversal-escaping ref (containment)", async () => {
    const bundle = await packHtmlBundle(HTML_REL);
    assert.equal(
      bundle.files.some((file) => file.bundlePath === "assets/passwd"),
      false,
    );
  });

  it("does not bundle a file link out of the workspace", { skip: isWindows }, async () => {
    const bundle = await packHtmlBundle(HTML_REL);
    assert.equal(
      bundle.files.some((file) => file.bundlePath === "assets/link-out.png"),
      false,
    );
  });

  // Read by path, a named pipe blocks until a writer appears; the verified open sees it is not a regular file.
  it("skips a named pipe without waiting on it", { skip: isWindows, timeout: 10_000 }, async () => {
    const bundle = await packHtmlBundle(HTML_REL);
    assert.equal(
      bundle.files.some((file) => file.bundlePath === "assets/pipe.png"),
      false,
    );
  });

  it("derives the zip base name from the source file", async () => {
    assert.equal((await packHtmlBundle(HTML_REL)).name, "page");
  });

  it("throws when the html file does not exist", async () => {
    await assert.rejects(() => packHtmlBundle(`artifacts/html/${TOKEN}/nope.html`), /not found/);
  });

  it("rejects an html path that escapes the workspace (containment)", async () => {
    await assert.rejects(() => packHtmlBundle("artifacts/html/../../../../../../etc/passwd"), /not found or outside workspace/);
  });
});

describe("zipBundle", () => {
  it("produces a zip round-tripping index.html and assets", async () => {
    const bundle = await packHtmlBundle(HTML_REL);
    const zip = await JSZip.loadAsync(await zipBundle(bundle.files));
    assert.ok(zip.file("index.html"), "index.html in zip");
    const foo = zip.file("assets/foo.png");
    assert.ok(foo, "asset in zip");
    assert.deepEqual(await foo.async("nodebuffer"), IMG_BYTES);
  });
});

describe("packHtmlZip", () => {
  it("returns a safe .zip filename and a valid zip buffer", async () => {
    const { filename, zip } = await packHtmlZip(HTML_REL);
    assert.equal(filename, "page.zip");
    const loaded = await JSZip.loadAsync(zip);
    assert.ok(loaded.file("index.html"), "index.html in zip");
    assert.ok(loaded.file("assets/foo.png"), "asset in zip");
  });
});
