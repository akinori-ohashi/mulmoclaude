import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUTH_TOKEN_META_NAME, extractAuthTokenFromHtml } from "../../src/utils/auth/authTokenHtml.ts";

// The exact tag `index.html` carries, with the placeholder substituted.
const SERVED_TAG = `<meta name="${AUTH_TOKEN_META_NAME}" content="abc123" />`;

function page(head: string): string {
  return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    ${head}\n    <title>MulmoClaude</title>\n  </head>\n  <body><div id="app"></div></body>\n</html>`;
}

describe("extractAuthTokenFromHtml", () => {
  it("names the tag the repository's index.html carries", () => {
    const indexHtml = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf-8");
    assert.match(indexHtml, new RegExp(`<meta name="${AUTH_TOKEN_META_NAME}" content="`));
  });

  it("reads the token out of the served tag", () => {
    assert.equal(extractAuthTokenFromHtml(page(SERVED_TAG)), "abc123");
  });

  it("accepts the attributes in either order, with extra ones, in either case, over several lines", () => {
    assert.equal(extractAuthTokenFromHtml(page(`<meta content="abc123" name="${AUTH_TOKEN_META_NAME}" data-x="y">`)), "abc123");
    assert.equal(extractAuthTokenFromHtml(page(`<META NAME="${AUTH_TOKEN_META_NAME}" CONTENT="abc123">`)), "abc123");
    assert.equal(extractAuthTokenFromHtml(page(`<meta\n      name="${AUTH_TOKEN_META_NAME}"\n      content="abc123"\n    />`)), "abc123");
  });

  it("is not fooled by other meta tags, before or after", () => {
    const head = [
      `<meta name="viewport" content="width=device-width" />`,
      `<meta name="description" content="${AUTH_TOKEN_META_NAME}" />`,
      SERVED_TAG,
      `<meta name="theme-color" content="#fff" />`,
    ].join("\n    ");
    assert.equal(extractAuthTokenFromHtml(page(head)), "abc123");
  });

  it("returns null when the tag is missing", () => {
    assert.equal(extractAuthTokenFromHtml(page(`<meta name="viewport" content="width=device-width" />`)), null);
    assert.equal(extractAuthTokenFromHtml(""), null);
  });

  it("returns null when the content is empty — what a non-loopback requester, or no running server, is served", () => {
    assert.equal(extractAuthTokenFromHtml(page(`<meta name="${AUTH_TOKEN_META_NAME}" content="" />`)), null);
  });

  it("returns null when the tag has no content attribute", () => {
    assert.equal(extractAuthTokenFromHtml(page(`<meta name="${AUTH_TOKEN_META_NAME}" />`)), null);
  });
});
