// nodemailer 10 narrowed `info.accepted` / `info.rejected` from
// `Array<string | Address>` to `string[]`. The narrower type is the SMTP
// transport's truth, but the object shape is what other transports have
// historically returned, so the helper still reads both — a wrong guess here
// turns a delivered address into "" and trips the zero-accepted hard failure.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recipientAddress } from "../src/smtp";

describe("recipientAddress", () => {
  it("passes a plain string through, which is all SMTP returns", () => {
    assert.equal(recipientAddress("alice@example.com"), "alice@example.com");
  });

  it("reads the address out of the object shape other transports use", () => {
    assert.equal(recipientAddress({ address: "bob@example.com" }), "bob@example.com");
  });

  it("gives an empty string for an object with no address, so the caller filters it", () => {
    assert.equal(recipientAddress({}), "");
    assert.equal(recipientAddress({ address: undefined }), "");
  });

  it("keeps an empty string empty rather than inventing a value", () => {
    assert.equal(recipientAddress(""), "");
  });
});
