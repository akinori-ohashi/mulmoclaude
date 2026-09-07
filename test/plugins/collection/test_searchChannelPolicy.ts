// The host's answer to a custom view's `mc-view-ready` claim (#2959, #2963).
// The rule is pure so it can be pinned exhaustively here: its effects — a port
// closing, an async iframe rebuild — cannot be observed deterministically from
// a browser assertion, because the probe that orders messages within one
// document cannot order across a frame swap.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideSearchChannelClaim,
  MAX_FRAME_RECLAIMS,
  type SearchChannelState,
} from "../../../packages/plugins/collection-plugin/src/vue/searchChannelPolicy.js";

const STATES: SearchChannelState[] = ["idle", "connected", "rebuilding", "exhausted"];

describe("decideSearchChannelClaim", () => {
  it("hands the channel to the first claim on a frame the host just built", () => {
    // The bootstrap is injected at the start of `<head>`, so it runs before any
    // script in the view's `<head>` or `<body>` — an idle frame's first claim is
    // normally the view the host installed, whatever the reclaim count. (A
    // `<script>` placed BEFORE `<head>` would run earlier and could claim first;
    // it gains nothing — it is the view's own document — but it spends that
    // view's reinstall budget. Costed in the plan, not fixed: moving the
    // injection would move the CSP `<meta>` with it.)
    assert.equal(decideSearchChannelClaim("idle", 0), "connect");
    assert.equal(decideSearchChannelClaim("idle", MAX_FRAME_RECLAIMS), "connect");
    assert.equal(decideSearchChannelClaim("idle", 1_000), "connect");
  });

  it("answers a claim on a connected frame by reinstalling, never by handing it over", () => {
    // A second claim means the document changed underneath the host. It cannot
    // tell a self-reload from a page the view navigated to, so it rebuilds the
    // frame instead of choosing. Crucially: never "connect".
    for (let reclaims = 0; reclaims < MAX_FRAME_RECLAIMS; reclaims++) {
      assert.equal(decideSearchChannelClaim("connected", reclaims), "reinstall");
    }
  });

  it("stops reconnecting once the rebuild budget is spent", () => {
    // Each rebuild mints a token, so a view reloading in a loop must not be
    // able to spend them forever.
    assert.equal(decideSearchChannelClaim("connected", MAX_FRAME_RECLAIMS), "giveUp");
    assert.equal(decideSearchChannelClaim("connected", MAX_FRAME_RECLAIMS + 1), "giveUp");
    assert.equal(decideSearchChannelClaim("connected", Number.MAX_SAFE_INTEGER), "giveUp");
  });

  it("keeps refusing once exhausted, however many times it is asked", () => {
    // The regression that mattered: refusing a claim closes the host's port, so
    // if "gave up" were merely "no port held" the very next claim from that same
    // document would look like a fresh frame — and be handed the user's search
    // text. Exhaustion is terminal, at every reclaim count.
    const asked = [0, 1, MAX_FRAME_RECLAIMS - 1, MAX_FRAME_RECLAIMS, MAX_FRAME_RECLAIMS + 5, Number.MAX_SAFE_INTEGER];
    asked.forEach((reclaims) => {
      assert.equal(decideSearchChannelClaim("exhausted", reclaims), "giveUp", `exhausted must refuse at reclaims=${reclaims}`);
    });
  });

  it("refuses back-to-back claims while a rebuild is in flight", () => {
    // Rebuilding is asynchronous — a token mint and two fetches — and the OLD
    // document sits in the frame for all of it. If that window read as
    // connectable, the document being replaced could simply ask again and be
    // handed the search text (#2963 review, codex iteration 7).
    const asked = [0, 1, MAX_FRAME_RECLAIMS - 1, MAX_FRAME_RECLAIMS, MAX_FRAME_RECLAIMS + 5];
    asked.forEach((reclaims) => {
      assert.equal(decideSearchChannelClaim("rebuilding", reclaims), "ignore", `rebuilding must refuse at reclaims=${reclaims}`);
    });
  });

  it("never spends a second rebuild on a frame already being rebuilt", () => {
    // "ignore" rather than "reinstall": a claimant asking in a loop would
    // otherwise burn the whole budget inside one rebuild window.
    Array.from({ length: 20 }, (_, reclaims) => decideSearchChannelClaim("rebuilding", reclaims)).forEach((action) => {
      assert.equal(action, "ignore");
    });
  });

  it("grants exactly MAX_FRAME_RECLAIMS rebuilds, counting from zero", () => {
    // The off-by-one that would either waste a rebuild or grant one too many.
    const granted = Array.from({ length: MAX_FRAME_RECLAIMS + 3 }, (_, reclaims) => decideSearchChannelClaim("connected", reclaims)).filter(
      (action) => action === "reinstall",
    ).length;
    assert.equal(granted, MAX_FRAME_RECLAIMS);
  });

  it("never connects anything but a frame the host just built", () => {
    // The security property, stated on its own: whatever the count and whatever
    // the state, only an idle frame is handed the channel.
    STATES.filter((state) => state !== "idle").forEach((state) => {
      Array.from({ length: 50 }, (_, reclaims) => decideSearchChannelClaim(state, reclaims)).forEach((action) => {
        assert.notEqual(action, "connect", `${state} must never be handed the channel`);
      });
    });
  });

  it("keeps the budget at the number the authoring docs promise", () => {
    // `custom-view.md` tells view authors "at most 3". Changing the constant
    // without changing that sentence would make the contract a lie, and every
    // other test here is written against the symbol, so nothing else notices.
    assert.equal(MAX_FRAME_RECLAIMS, 3);
  });

  it("honours an injected budget, including a zero that disables reconnecting", () => {
    assert.equal(decideSearchChannelClaim("connected", 0, 0), "giveUp");
    assert.equal(decideSearchChannelClaim("connected", 0, 1), "reinstall");
    assert.equal(decideSearchChannelClaim("connected", 1, 1), "giveUp");
    // A frame the host built still connects even when reconnecting is disabled.
    assert.equal(decideSearchChannelClaim("idle", 0, 0), "connect");
  });

  it("returns one of the four actions for every state and count", () => {
    STATES.forEach((state) => {
      [0, 1, 3, 99].forEach((reclaims) => {
        assert.ok(["connect", "reinstall", "ignore", "giveUp"].includes(decideSearchChannelClaim(state, reclaims)));
      });
    });
  });
});
