// Unit tests for the presence/capability advertisement (buildHostPresence):
//   - capabilities are derived straight from the handler table keys
//   - hostId comes from the channel, protocolVersion is the current constant
//   - the online flag is reflected verbatim (same shape online and offline)
//   - an empty handler table advertises an empty capability list
//
// The builder is pure (no Firebase), so this needs no host or firestore fakes.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { REMOTE_HOST_PROTOCOL_VERSION, buildHostPresence, type Channel, type CommandHandlers } from "../../src/remote-host/index.js";

const channel: Channel = { uid: "uid-1", hostId: "test-host" };
const handlers: CommandHandlers = {
  listCollections: () => null,
  startChat: () => null,
};

describe("buildHostPresence", () => {
  it("advertises the handler table keys as capabilities", () => {
    const presence = buildHostPresence(channel, handlers, true);
    assert.deepEqual(presence, {
      online: true,
      hostId: "test-host",
      protocolVersion: REMOTE_HOST_PROTOCOL_VERSION,
      capabilities: ["listCollections", "startChat"],
    });
  });

  it("capabilities track the live table — registering a handler advertises it", () => {
    const withMore: CommandHandlers = { ...handlers, getCollection: () => null };
    assert.deepEqual(buildHostPresence(channel, withMore, true).capabilities, ["listCollections", "startChat", "getCollection"]);
  });

  it("reflects the online flag but keeps the same capability shape offline", () => {
    const offline = buildHostPresence(channel, handlers, false);
    assert.equal(offline.online, false);
    assert.deepEqual(offline.capabilities, ["listCollections", "startChat"]);
  });

  it("advertises an empty capability list for an empty handler table", () => {
    assert.deepEqual(buildHostPresence(channel, {}, true).capabilities, []);
  });

  it("carries the machine fields only when a machine is given", () => {
    const presence = buildHostPresence(channel, handlers, true, { machineId: "m-1", label: "work-mac" });
    assert.equal(presence.machineId, "m-1");
    assert.equal(presence.label, "work-mac");
    assert.equal("machineId" in buildHostPresence(channel, handlers, true), false);
    assert.equal("label" in buildHostPresence(channel, handlers, true), false);
  });

  it("copies only the machine fields, nothing else the object happens to hold", () => {
    const machine = { machineId: "m-1", label: "work-mac", secret: "x" };
    assert.deepEqual(Object.keys(buildHostPresence(channel, handlers, false, machine)).sort(), [
      "capabilities",
      "hostId",
      "label",
      "machineId",
      "online",
      "protocolVersion",
    ]);
  });
});
