// renderMarkdownHtml (server/api/routes/pdf.ts) is the shared markdown →
// self-contained HTML stage behind both the PDF export and the share zip.
// Verify it inlines CSS + local images so the zipped index.html opens
// standalone.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import { resolveWorkspacePath } from "../../server/utils/files/workspace-io.js";
import { renderMarkdownHtml } from "../../server/api/routes/pdf.js";

const TOKEN = "__share_md_test__";
const IMG_REL = `data/${TOKEN}/pic.png`;
const IMG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const imgAbsDir = path.dirname(resolveWorkspacePath(IMG_REL));

before(async () => {
  await mkdir(imgAbsDir, { recursive: true });
  await writeFile(resolveWorkspacePath(IMG_REL), IMG_BYTES);
});

after(async () => {
  await rm(imgAbsDir, { recursive: true, force: true });
});

describe("renderMarkdownHtml", () => {
  it("produces a self-contained HTML with inline CSS and data-URI images", async () => {
    const html = await renderMarkdownHtml({ markdown: "# Title\n\n![pic](pic.png)\n", baseDir: `data/${TOKEN}` });
    assert.match(html, /<!DOCTYPE html>/i);
    // Nonced since #3151: `style-src` names a per-render nonce so an
    // author `<style>` block cannot restyle the exported document, and the
    // route's own stylesheet has to carry it to survive its own policy.
    assert.match(html, /<style nonce="[0-9a-f-]{36}">/);
    assert.match(html, /Title<\/h1>/);
    assert.match(html, /data:image\/png;base64,/);
    assert.doesNotMatch(html, /src="pic\.png"/);
  });

  it("leaves a remote image url untouched", async () => {
    const html = await renderMarkdownHtml({ markdown: "![x](https://cdn.example/x.png)" });
    assert.match(html, /https:\/\/cdn\.example\/x\.png/);
  });

  it("strips a frontmatter envelope when asked", async () => {
    const html = await renderMarkdownHtml({ markdown: "---\ntitle: T\n---\n\n# Body\n", stripFrontmatter: true });
    assert.match(html, /Body<\/h1>/);
    assert.doesNotMatch(html, /title: T/);
  });
});
