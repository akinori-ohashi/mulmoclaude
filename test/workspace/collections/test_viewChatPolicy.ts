import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// The draft-vs-send rule behind a custom view's `__MC_VIEW.startChat` (#3062).
// Pure, so the branch both view components take is pinned here rather than by
// driving a sandboxed iframe.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { customViewSendsChat } from "@mulmoclaude/core/collection";

describe("customViewSendsChat — a custom view's startChat drafts unless declared", () => {
  it("sends only for an explicit true", () => {
    assert.equal(customViewSendsChat({ allowSendChat: true }), true);
  });

  it("drafts when the declaration is absent (default-deny, so a host upgrade changes nothing)", () => {
    assert.equal(customViewSendsChat({}), false);
    assert.equal(customViewSendsChat({ allowSendChat: undefined }), false);
  });

  it("drafts on an explicit false", () => {
    assert.equal(customViewSendsChat({ allowSendChat: false }), false);
  });
});
