// Which pages may skip the confirmation bar, and when a direct send falls back to it. Both
// decide whether text reaches the conversation as the user without them seeing it first.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DIRECT_SUBMIT,
  DIRECT_SUBMIT_MIN_INTERVAL_MS,
  SUBMIT_KEY_PARAM,
  deliveryFor,
  submitModeFor,
  submitModeOfResult,
  withSubmitKey,
} from "../src/core/submitMode";

describe("submitModeFor", () => {
  it("grants direct submit to a new page written with html", () => {
    assert.equal(submitModeFor({ html: "<html></html>", submit: DIRECT_SUBMIT }), DIRECT_SUBMIT);
  });

  it("never grants it to a page opened by path", () => {
    assert.equal(submitModeFor({ path: "docs/report.html", submit: DIRECT_SUBMIT }), undefined);
    assert.equal(submitModeFor({ path: "/tmp/x.html", html: "<html></html>", submit: DIRECT_SUBMIT }), undefined);
  });

  it("needs non-empty html", () => {
    for (const html of [undefined, "", 1, null]) {
      assert.equal(submitModeFor({ html, submit: DIRECT_SUBMIT }), undefined);
    }
  });

  it("ignores any other submit value", () => {
    for (const submit of [undefined, "", "DIRECT", "confirm", true, 1, ["direct"]]) {
      assert.equal(submitModeFor({ html: "<html></html>", submit }), undefined);
    }
  });

  it("ignores non-object args", () => {
    for (const args of [null, undefined, "direct", 7, [DIRECT_SUBMIT]]) {
      assert.equal(submitModeFor(args), undefined);
    }
  });

  it("treats an empty path as no path", () => {
    assert.equal(submitModeFor({ html: "<html></html>", path: "", submit: DIRECT_SUBMIT }), DIRECT_SUBMIT);
  });
});

describe("submitModeOfResult", () => {
  const artifact = "artifacts/html/2026/10/plan-1.html";

  it("honours the flag on a page this tool wrote", () => {
    assert.equal(submitModeOfResult({ filePath: artifact, submit: DIRECT_SUBMIT }), DIRECT_SUBMIT);
  });

  it("refuses the flag on a result pointing anywhere else, as a forged or restored result could", () => {
    for (const filePath of ["docs/report.html", "/tmp/x.html", "artifacts/html/../../repo/x.html", "artifacts/htmlx/a.html", "artifacts/html/a.txt"]) {
      assert.equal(submitModeOfResult({ filePath, submit: DIRECT_SUBMIT }), undefined, filePath);
    }
  });

  it("accepts a previewUrl that is the canonical URL of that artifact, and refuses any other", () => {
    assert.equal(submitModeOfResult({ filePath: artifact, previewUrl: `/${artifact}`, submit: DIRECT_SUBMIT }), DIRECT_SUBMIT);
    for (const previewUrl of [
      "/htmlfile/ws/docs/report.html",
      "https://example.com/x.html",
      "/artifacts/html/2026/10/other.html",
      `/${artifact}?x=1`,
      "",
      null,
      1,
    ]) {
      assert.equal(submitModeOfResult({ filePath: artifact, previewUrl, submit: DIRECT_SUBMIT }), undefined, String(previewUrl));
    }
  });

  it("refuses a missing or non-string filePath", () => {
    for (const filePath of [undefined, null, 1, ["artifacts/html/a.html"]]) {
      assert.equal(submitModeOfResult({ filePath, submit: DIRECT_SUBMIT }), undefined);
    }
  });

  it("needs the exact flag", () => {
    for (const submit of [undefined, "DIRECT", true, "confirm"]) {
      assert.equal(submitModeOfResult({ filePath: artifact, submit }), undefined);
    }
  });

  it("ignores non-object data", () => {
    for (const data of [null, undefined, "direct", 3, [artifact]]) {
      assert.equal(submitModeOfResult(data), undefined);
    }
  });
});

describe("deliveryFor", () => {
  const now = 100_000;
  const key = "k-123";
  const direct = (over: Partial<Parameters<typeof deliveryFor>[0]> = {}) =>
    deliveryFor({ mode: DIRECT_SUBMIT, expectedKey: key, givenKey: key, lastDirectAtMs: null, nowMs: now, ...over });

  it("confirms everything for a page without the mode", () => {
    assert.equal(direct({ mode: undefined }), "confirm");
    assert.equal(direct({ mode: undefined, lastDirectAtMs: now - 10 * DIRECT_SUBMIT_MIN_INTERVAL_MS }), "confirm");
  });

  it("sends the first submit of a direct page carrying its key straight away", () => {
    assert.equal(direct(), "direct");
  });

  it("confirms a submit without the key, with another key, or when no key was issued", () => {
    assert.equal(direct({ givenKey: undefined }), "confirm");
    assert.equal(direct({ givenKey: "k-124" }), "confirm");
    assert.equal(direct({ givenKey: "" }), "confirm");
    assert.equal(direct({ expectedKey: undefined, givenKey: undefined }), "confirm");
    assert.equal(direct({ expectedKey: "", givenKey: "" }), "confirm");
  });

  it("sends directly again once the interval has passed, and not before", () => {
    assert.equal(direct({ lastDirectAtMs: now - DIRECT_SUBMIT_MIN_INTERVAL_MS }), "direct");
    assert.equal(direct({ lastDirectAtMs: now - DIRECT_SUBMIT_MIN_INTERVAL_MS + 1 }), "confirm");
    assert.equal(direct({ lastDirectAtMs: now }), "confirm");
  });

  it("confirms when the last send appears to be in the future", () => {
    assert.equal(direct({ lastDirectAtMs: now + 1 }), "confirm");
    assert.equal(direct({ lastDirectAtMs: now + 10 * DIRECT_SUBMIT_MIN_INTERVAL_MS }), "confirm");
  });
});

describe("withSubmitKey", () => {
  it("puts the key in the fragment, encoded, after the query", () => {
    assert.equal(withSubmitKey("/artifacts/html/a.html?v=3", "a b&c"), "/artifacts/html/a.html?v=3#mulmo-submit-key=a%20b%26c");
  });

  it("adds to a fragment the URL already has, so the page still finds its key", () => {
    const src = withSubmitKey("/artifacts/html/a.html#section", "k");
    assert.equal(src, "/artifacts/html/a.html#section&mulmo-submit-key=k");
    assert.equal(new URLSearchParams(new URL(src, "http://h").hash.slice(1)).get(SUBMIT_KEY_PARAM), "k");
    assert.equal(withSubmitKey("/a.html#", "k"), "/a.html#mulmo-submit-key=k");
  });

  it("reads back with URLSearchParams on the fragment, as the page does", () => {
    const url = new URL(withSubmitKey("http://h/a.html", "k=1#2"), "http://h");
    assert.equal(new URLSearchParams(url.hash.slice(1)).get(SUBMIT_KEY_PARAM), "k=1#2");
  });
});
