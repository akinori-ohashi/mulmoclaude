// Which pages may skip the confirmation bar, and when a direct send falls back to it. Both
// decide whether text reaches the conversation as the user without them seeing it first.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DIRECT_SUBMIT, DIRECT_SUBMIT_MIN_INTERVAL_MS, deliveryFor, submitModeFor } from "../src/core/submitMode";

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

describe("deliveryFor", () => {
  const now = 100_000;

  it("confirms everything for a page without the mode", () => {
    assert.equal(deliveryFor(undefined, null, now), "confirm");
    assert.equal(deliveryFor(undefined, now - 10 * DIRECT_SUBMIT_MIN_INTERVAL_MS, now), "confirm");
  });

  it("sends the first submit of a direct page straight away", () => {
    assert.equal(deliveryFor(DIRECT_SUBMIT, null, now), "direct");
  });

  it("sends directly again once the interval has passed, and not before", () => {
    assert.equal(deliveryFor(DIRECT_SUBMIT, now - DIRECT_SUBMIT_MIN_INTERVAL_MS, now), "direct");
    assert.equal(deliveryFor(DIRECT_SUBMIT, now - DIRECT_SUBMIT_MIN_INTERVAL_MS + 1, now), "confirm");
    assert.equal(deliveryFor(DIRECT_SUBMIT, now, now), "confirm");
  });

  it("confirms when the last send appears to be in the future", () => {
    assert.equal(deliveryFor(DIRECT_SUBMIT, now + 1, now), "confirm");
    assert.equal(deliveryFor(DIRECT_SUBMIT, now + 10 * DIRECT_SUBMIT_MIN_INTERVAL_MS, now), "confirm");
  });
});
