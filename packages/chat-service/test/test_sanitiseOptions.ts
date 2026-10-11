// Unit tests for the bridge-options sanitiser. The function is the
// sole defender of the wire contract's "flat primitives only" rule,
// so every non-primitive branch needs a regression test: if a future
// refactor relaxes this, the host app's startChat callback
// immediately regains access to nested objects and the
// prototype-pollution risk that motivated the narrowing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitiseOptions } from "../src/handshake.js";

describe("sanitiseOptions", () => {
  it("passes through a flat record of primitives verbatim", () => {
    const out = sanitiseOptions({ defaultRole: "slack", maxPageSize: 50, verbose: true });
    assert.deepEqual(out, { defaultRole: "slack", maxPageSize: 50, verbose: true });
  });

  it("returns an empty object when the input isn't an object", () => {
    assert.deepEqual(sanitiseOptions(undefined), {});
    assert.deepEqual(sanitiseOptions(null), {});
    assert.deepEqual(sanitiseOptions("string"), {});
    assert.deepEqual(sanitiseOptions(42), {});
    assert.deepEqual(sanitiseOptions(true), {});
  });

  it("rejects arrays (they're 'typeof object' but not a Record shape)", () => {
    assert.deepEqual(sanitiseOptions([1, 2, 3]), {});
    assert.deepEqual(sanitiseOptions(["a", "b"]), {});
  });

  it("drops nested object values — the central wire-contract check", () => {
    const out = sanitiseOptions({
      defaultRole: "slack",
      deeplyNested: { foo: { bar: "leaked" } },
      alsoDropped: { __proto__: { polluted: true } },
    });
    // Only the flat primitive survives.
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("drops nested arrays as well", () => {
    const out = sanitiseOptions({
      defaultRole: "slack",
      channels: ["c1", "c2"],
    });
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("drops null / undefined / function / symbol / bigint values", () => {
    const out = sanitiseOptions({
      keepMe: "string",
      keepNumber: 10,
      dropNull: null,
      dropUndefined: undefined,
      dropFunction: () => "anything",
      dropSymbol: Symbol("x"),
      dropBigInt: BigInt(10),
    });
    assert.deepEqual(out, { keepMe: "string", keepNumber: 10 });
  });

  it("drops non-finite numbers (NaN / Infinity) so they can't serialise oddly", () => {
    const out = sanitiseOptions({
      good: 42,
      nan: Number.NaN,
      posInf: Number.POSITIVE_INFINITY,
      negInf: Number.NEGATIVE_INFINITY,
    });
    assert.deepEqual(out, { good: 42 });
  });

  it("strips prototype-polluting keys at the top level", () => {
    // We can't write `__proto__: …` as a literal and expect the
    // runtime to treat it as an own property, so construct via
    // Object.defineProperty to simulate a hostile bridge payload.
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "__proto__", { value: "evil", enumerable: true });
    Object.defineProperty(hostile, "constructor", { value: "evil", enumerable: true });
    Object.defineProperty(hostile, "prototype", { value: "evil", enumerable: true });
    hostile.defaultRole = "slack";
    const out = sanitiseOptions(hostile);
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("returns a fresh object (caller can't mutate the input through it)", () => {
    const input = { defaultRole: "slack" };
    const out = sanitiseOptions(input);
    assert.notEqual(out, input);
  });
});
