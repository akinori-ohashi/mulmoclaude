// When the dev proxy should be re-aimed at a different backend port (#2995).
//
// The negative cases carry the weight. `.server-port` is removed and rewritten
// across runs, so a follower that moved the proxy on every reading would aim it
// at whatever a half-state seemed to say — which is the failure the whole
// following effort exists to prevent, arriving by a new route.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createProxyTargetFollower } from "../../scripts/lib/proxyTargetFollower.js";
import { parsePublishedPort } from "../../scripts/lib/devServerPort.js";

/** A follower reading a value the test controls. */
function follower(initialPort: number, readings: (string | null)[]) {
  const switched: number[] = [];
  let index = 0;
  const instance = createProxyTargetFollower({
    initialPort,
    readPublished: () => readings[Math.min(index++, readings.length - 1)] ?? null,
    parsePort: parsePublishedPort,
    onSwitch: (port) => switched.push(port),
  });
  return { instance, switched };
}

describe("createProxyTargetFollower", () => {
  it("re-aims when the backend turns up on a different port", () => {
    const { instance, switched } = follower(3001, ["3002\n"]);
    instance.poll();
    assert.deepEqual(switched, [3002]);
    assert.equal(instance.currentPort(), 3002);
  });

  it("does nothing when the published port is the one already in use", () => {
    const { instance, switched } = follower(3001, ["3001\n"]);
    instance.poll();
    assert.deepEqual(switched, []);
  });

  it("switches once, not on every poll", () => {
    const { instance, switched } = follower(3001, ["3002\n", "3002\n", "3002\n"]);
    instance.poll();
    instance.poll();
    instance.poll();
    assert.deepEqual(switched, [3002], "a steady published port must not re-aim repeatedly");
  });

  it("leaves the proxy alone when the file is missing", () => {
    // `--reset` removes it, and a crashed run leaves it absent. Neither says
    // "the backend moved".
    const { instance, switched } = follower(3001, [null]);
    instance.poll();
    assert.deepEqual(switched, []);
    assert.equal(instance.currentPort(), 3001);
  });

  it("leaves the proxy alone for anything that is not a port", () => {
    ["", "   ", "\n", "not-a-port", "0", "-1", "99999999"].forEach((raw) => {
      const { instance, switched } = follower(3001, [raw]);
      instance.poll();
      assert.deepEqual(switched, [], `"${raw}" must not move the proxy`);
    });
  });

  it("follows a backend that moves more than once", () => {
    // The supervisor restarting onto a different port, twice.
    const { instance, switched } = follower(3001, ["3002\n", "3003\n"]);
    instance.poll();
    instance.poll();
    assert.deepEqual(switched, [3002, 3003]);
  });

  it("recovers the target after the file briefly goes missing", () => {
    // A republish is a delete-then-rename; a poll landing in between must not
    // reset anything, and the next real value must still be followed.
    const { instance, switched } = follower(3001, [null, "3002\n"]);
    instance.poll();
    instance.poll();
    assert.deepEqual(switched, [3002]);
  });
});
