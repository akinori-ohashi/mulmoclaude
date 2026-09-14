import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSave, shouldStartSave, type SaveResolution } from "../../src/components/settingsFieldSave.js";

// The Model tab's two selects auto-save on `@change`, and the ordering rules
// live here because the component itself has no unit harness. The regression
// these pin (CodeRabbit, PR #3118): a draft that moved during an in-flight
// request was only re-sent on the SUCCESS path, so a failed save stranded the
// newer selection — visible in the select, never sent, and unreachable because
// re-picking the same option fires no change event.

describe("shouldStartSave", () => {
  it("starts when the draft differs from what is stored", () => {
    assert.equal(shouldStartSave(false, "sonnet", ""), true);
    assert.equal(shouldStartSave(false, "", "sonnet"), true);
    assert.equal(shouldStartSave(false, "haiku", "sonnet"), true);
  });

  it("does not start a second request while one is in flight", () => {
    assert.equal(shouldStartSave(true, "haiku", "sonnet"), false);
    assert.equal(shouldStartSave(true, "", "sonnet"), false);
  });

  it("does not PUT a no-op", () => {
    assert.equal(shouldStartSave(false, "sonnet", "sonnet"), false);
    assert.equal(shouldStartSave(false, "", ""), false);
  });
});

describe("resolveSave", () => {
  it("stores the requested value only when the request succeeded", () => {
    assert.equal(resolveSave(true, "sonnet", "sonnet").store, true);
    assert.equal(resolveSave(false, "sonnet", "sonnet").store, false);
  });

  it("resends a moved draft on the SUCCESS path", () => {
    assert.deepEqual(resolveSave(true, "haiku", "sonnet"), { store: true, resend: true } satisfies SaveResolution);
  });

  // The regression. Failure used to return before the resend was considered.
  it("resends a moved draft on the FAILURE path too", () => {
    assert.deepEqual(resolveSave(false, "haiku", "sonnet"), { store: false, resend: true } satisfies SaveResolution);
  });

  it("does not resend when the draft never moved, whichever way the request went", () => {
    assert.equal(resolveSave(true, "sonnet", "sonnet").resend, false);
    assert.equal(resolveSave(false, "sonnet", "sonnet").resend, false);
  });

  // A cleared selection is `""`, not absence — it must sequence like any other
  // value or clearing a field during an in-flight save would be dropped.
  it("treats the cleared selection as a value in both directions", () => {
    assert.equal(resolveSave(true, "", "sonnet").resend, true);
    assert.equal(resolveSave(false, "", "sonnet").resend, true);
    assert.equal(resolveSave(true, "sonnet", "").resend, true);
    assert.equal(resolveSave(false, "", "").resend, false);
  });

  // The loop must be able to stop: once the draft has settled, the resolution
  // of the request carrying it asks for no further send.
  it("terminates once the draft settles", () => {
    const settled = resolveSave(true, "haiku", "haiku");
    assert.equal(settled.resend, false);
    assert.equal(settled.store, true);
  });
});
