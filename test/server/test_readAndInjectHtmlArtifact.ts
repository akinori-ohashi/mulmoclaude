// Coverage for the HTML-artifact splice path that powers iframe
// self-repair (#1025). The middleware in `server/index.ts` mounts
// this helper against `/artifacts/html`; we exercise the helper
// directly so we don't need a full Express + supertest harness.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath as fsRealpath, rename, rm, symlink, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import type { VerifiedScope } from "@mulmoclaude/core/files";
import { readAndInjectHtmlArtifact } from "../../server/utils/html/htmlArtifactSplicer.js";

let workspaceRoot: string;
let htmlsRoot: string;
let scope: VerifiedScope;

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmo-iframe-repair-"));
  await mkdir(path.join(workspaceRoot, "html"), { recursive: true });
  // The anchor must be a realpath; on macOS /tmp is a symlink to /private/tmp.
  workspaceRoot = await fsRealpath(workspaceRoot);
  htmlsRoot = path.join(workspaceRoot, "html");
  scope = { trustedReal: workspaceRoot, scopeWithinTrusted: "html" };
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("readAndInjectHtmlArtifact", () => {
  it("splices the script before </body> for a well-formed page", async () => {
    const file = path.join(htmlsRoot, "ok.html");
    await writeFile(file, "<html><body><p>hello</p></body></html>", "utf8");
    const out = await readAndInjectHtmlArtifact(scope, "ok.html");
    assert.ok(out !== null);
    assert.match(out, /<\/p><script>[\s\S]+<\/script><\/body>/);
  });

  it("appends the script when the document has no </body> close", async () => {
    const file = path.join(htmlsRoot, "fragment.html");
    await writeFile(file, "<p>just a fragment</p>", "utf8");
    const out = await readAndInjectHtmlArtifact(scope, "fragment.html");
    assert.ok(out !== null);
    assert.ok(out.startsWith("<p>just a fragment</p>"));
    assert.ok(out.includes("<script>"));
    assert.ok(out.endsWith("</script>"));
  });

  it("preserves all original characters around the splice point", async () => {
    const file = path.join(htmlsRoot, "preserve.html");
    const html = "<html><body><div>content</div></body></html>";
    await writeFile(file, html, "utf8");
    const out = await readAndInjectHtmlArtifact(scope, "preserve.html");
    assert.ok(out !== null);
    // Strip ALL injected scripts (image repair + height reporter)
    // before comparing — both run via the splicer chain.
    assert.equal(out.replace(/<script>[\s\S]+?<\/script>/g, ""), html);
  });

  it("returns null when the path escapes htmlsRoot via traversal", async () => {
    const out = await readAndInjectHtmlArtifact(scope, "../escape.html");
    assert.equal(out, null);
  });

  it("returns null when the file does not exist", async () => {
    const out = await readAndInjectHtmlArtifact(scope, "missing.html");
    assert.equal(out, null);
  });

  it("returns null for an absolute path (outside the scope)", async () => {
    const out = await readAndInjectHtmlArtifact(scope, "/etc/passwd");
    assert.equal(out, null);
  });

  it("works on files in nested subdirectories under htmlsRoot", async () => {
    const subDir = path.join(htmlsRoot, "2026", "04");
    await mkdir(subDir, { recursive: true });
    await writeFile(path.join(subDir, "page.html"), "<body>x</body>", "utf8");
    const out = await readAndInjectHtmlArtifact(scope, "2026/04/page.html");
    assert.ok(out !== null);
    assert.match(out, /x<script>[\s\S]+<\/script><\/body>/);
  });

  it("returns null when the html folder is a link out of the workspace", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "mulmo-iframe-outside-"));
    await writeFile(path.join(outside, "secret.html"), "<body>secret</body>", "utf8");
    await rename(htmlsRoot, `${htmlsRoot}-real`);
    await symlink(outside, htmlsRoot);
    try {
      assert.equal(await readAndInjectHtmlArtifact(scope, "secret.html"), null);
    } finally {
      await rm(htmlsRoot);
      await rename(`${htmlsRoot}-real`, htmlsRoot);
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns null for a directory with an html name", async () => {
    await mkdir(path.join(htmlsRoot, "dir.html"), { recursive: true });
    assert.equal(await readAndInjectHtmlArtifact(scope, "dir.html"), null);
  });

  it("would happily serve a dotfile if asked — the dotfile-deny policy lives in the middleware, not here", async () => {
    // Documents the contract split: `readAndInjectHtmlArtifact` is
    // "pure read + splice". Dotfile rejection is enforced upstream
    // in `server/index.ts` for parity with `express.static`'s
    // `dotfiles: "deny"`. If you call this helper directly with a
    // dotfile name, it WILL serve it.
    await writeFile(path.join(htmlsRoot, ".hidden.html"), "<body>secret</body>", "utf8");
    const out = await readAndInjectHtmlArtifact(scope, ".hidden.html");
    assert.ok(out !== null);
    assert.match(out, /secret<script>/);
  });
});
