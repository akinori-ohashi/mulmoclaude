// `config/bridges.json` decides which bridges the server starts in its own
// process (#3080), so every malformed shape a user can type has to produce a
// reported reason rather than a silently missing bridge.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBridgesConfig } from "../../server/bridges/config.js";

describe("parseBridgesConfig", () => {
  it("returns the transports switched on, in file order", () => {
    const config = parseBridgesConfig({ bridges: { telegram: { enabled: true }, slack: { enabled: false }, discord: { enabled: true } } });
    assert.deepEqual(config.enabled, ["telegram", "discord"]);
    assert.deepEqual(config.rejected, []);
  });

  it("treats a missing or unreadable file as no bridges, not as an error", () => {
    for (const raw of [{}, null, undefined, [], "telegram", 42]) {
      assert.deepEqual(parseBridgesConfig(raw).enabled, [], JSON.stringify(raw) ?? "undefined");
    }
  });

  it("reports a malformed entry instead of dropping it", () => {
    const config = parseBridgesConfig({
      bridges: { telegram: { enabled: "yes" }, slack: true, discord: { on: true } },
    });
    assert.deepEqual(config.enabled, []);
    assert.deepEqual(
      config.rejected.map((entry) => entry.key),
      ["telegram", "slack", "discord"],
      "a typo'd entry that vanishes looks exactly like a bridge the server chose not to start",
    );
  });

  // A transport id names a directory under `packages/bridges/` and a socket
  // room (`bridge:${transportId}`), so it is validated rather than normalised.
  it("refuses a transport id that could traverse a path or collide with the room prefix", () => {
    const config = parseBridgesConfig({
      bridges: { "../../etc/passwd": { enabled: true }, "bridge:telegram": { enabled: true }, Telegram: { enabled: true }, "tele gram": { enabled: true } },
    });
    assert.deepEqual(config.enabled, []);
    assert.equal(config.rejected.length, 4);
  });

  it("accepts the id shapes the repo actually uses", () => {
    const config = parseBridgesConfig({
      bridges: { telegram: { enabled: true }, "google-chat": { enabled: true }, "line-works": { enabled: true }, "twilio-sms": { enabled: true } },
    });
    assert.deepEqual(config.enabled, ["telegram", "google-chat", "line-works", "twilio-sms"]);
  });

  it("ignores extra keys on an otherwise valid entry", () => {
    const config = parseBridgesConfig({ bridges: { telegram: { enabled: true, note: "prod bot" } } });
    assert.deepEqual(config.enabled, ["telegram"]);
    assert.deepEqual(config.rejected, []);
  });
});
