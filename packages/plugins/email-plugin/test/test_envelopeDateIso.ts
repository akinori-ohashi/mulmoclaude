// imapflow 2 widened `envelope.date` from `Date` to `Date | string`, so the
// value reaching the summary can now be an unparsed header string. Calling
// `.toISOString()` on it would throw out of a whole `listMessages` call, which
// is why the helper parses first and degrades a bad value to null.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { envelopeDateIso } from "../src/imap";

describe("envelopeDateIso — the shapes imapflow can hand over", () => {
  it("keeps a Date, which is what v1 always gave", () => {
    assert.equal(envelopeDateIso(new Date("2026-09-14T01:23:45.000Z")), "2026-09-14T01:23:45.000Z");
  });

  it("parses the header string that v2 can give instead", () => {
    assert.equal(envelopeDateIso("Sun, 14 Sep 2026 01:23:45 +0000"), "2026-09-14T01:23:45.000Z");
  });

  it("reads an ISO string the same way as its Date", () => {
    const iso = "2026-01-02T03:04:05.000Z";
    assert.equal(envelopeDateIso(iso), envelopeDateIso(new Date(iso)));
  });
});

describe("envelopeDateIso — absent and malformed values", () => {
  it("returns null for undefined", () => {
    assert.equal(envelopeDateIso(undefined), null);
  });

  it("returns null for an empty string rather than the epoch", () => {
    assert.equal(envelopeDateIso(""), null);
  });

  it("returns null instead of throwing on an unparseable date", () => {
    ["not a date", "0000-99-99", "Sun, 99 Xxx 2026"].forEach((raw) => {
      assert.equal(envelopeDateIso(raw), null, raw);
    });
  });

  it("returns null for an Invalid Date object", () => {
    assert.equal(envelopeDateIso(new Date("nonsense")), null);
  });
});
