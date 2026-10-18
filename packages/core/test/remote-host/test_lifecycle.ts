// Unit tests for the remote-host lifecycle invariants (createRemoteHost):
//   - connect starts a runner and reports connected + uid
//   - connect is NON-DESTRUCTIVE: a failed reconnect leaves the healthy session
//   - connect/disconnect are SERIALIZED: overlapping calls never leak a 2nd runner
//   - disconnect stops the runner + signs out
//   - a FATAL listener death reconciles status() back to disconnected, and the
//     reconciliation is identity-guarded (a superseded runner can't clear a newer one)
//
// The factory takes injected fakes (including a pre-bound startRunner + hostId),
// so these run without Firebase.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRemoteHost, type RemoteHostDeps } from "../../src/remote-host/server/lifecycle.js";
import type { Channel, Command } from "../../src/remote-host/index.js";

const HOST_ID = "test-host";

interface FakeRunner {
  channel: Channel;
  stopped: boolean;
  onClosed?: (() => void) | undefined;
  onExpire?: ((command: Command, uid: string) => void | Promise<void>) | undefined;
  stop: () => void;
}

// Build a lifecycle backed by fakes. signIn maps a token to a uid (and updates
// the "current user"), except the token "bad" which rejects — mirroring
// signInWithCredential leaving currentUser unchanged on failure. An optional
// `onExpire` is forwarded into deps so a test can assert it reaches the runner.
const makeHarness = (onExpire?: RemoteHostDeps["onExpire"], overrides: Partial<RemoteHostDeps> = {}) => {
  const runners: FakeRunner[] = [];
  let uid: string | null = null;
  let signOutCount = 0;

  const startRunner: RemoteHostDeps["startRunner"] = (channel, _handlers, options) => {
    const runner: FakeRunner = { channel, stopped: false, onClosed: options?.onClosed, onExpire: options?.onExpire, stop: () => (runner.stopped = true) };
    runners.push(runner);
    return runner.stop;
  };

  const deps: RemoteHostDeps = {
    hostId: HOST_ID,
    signIn: async (idToken: string) => {
      if (idToken === "bad") throw new Error("rejected credential");
      uid = `uid-${idToken}`;
      return uid;
    },
    signOut: async () => {
      signOutCount += 1;
      uid = null;
    },
    currentUid: () => uid,
    startRunner,
    handlers: {},
    onExpire,
    ...overrides,
  };

  // A missing runner means the lifecycle under test never started one — fail there, not on a later property read.
  const runnerAt = (index: number): FakeRunner => {
    const runner = runners[index];
    assert.ok(runner, `expected a runner at index ${index}, got ${runners.length}`);
    return runner;
  };

  return { rh: createRemoteHost(deps), runners, runnerAt, signOutCount: () => signOutCount };
};

describe("createRemoteHost lifecycle", () => {
  it("connect starts a runner and reports connected + uid", async () => {
    const { rh, runners, runnerAt } = makeHarness();
    const status = await rh.connect("t1");
    assert.deepEqual(status, { connected: true, uid: "uid-t1" });
    assert.equal(runners.length, 1);
    assert.equal(runnerAt(0).stopped, false);
    assert.deepEqual(runnerAt(0).channel, { uid: "uid-t1", hostId: HOST_ID });
  });

  it("failed reconnect is non-destructive: keeps the existing healthy session", async () => {
    const { rh, runners, runnerAt } = makeHarness();
    await rh.connect("t1");
    await assert.rejects(rh.connect("bad"), /rejected credential/);
    // Old runner still running, no new runner, status unchanged.
    assert.equal(runners.length, 1);
    assert.equal(runnerAt(0).stopped, false);
    assert.deepEqual(rh.status(), { connected: true, uid: "uid-t1" });
  });

  it("serializes overlapping connects: stops the old runner before starting the new", async () => {
    const { rh, runners, runnerAt } = makeHarness();
    const [status1, status2] = await Promise.all([rh.connect("t1"), rh.connect("t2")]);
    assert.equal(runners.length, 2);
    assert.equal(runnerAt(0).stopped, true); // first runner torn down
    assert.equal(runnerAt(1).stopped, false); // second is the live one
    assert.equal(status1.uid, "uid-t1");
    assert.deepEqual(status2, { connected: true, uid: "uid-t2" });
    assert.deepEqual(rh.status(), { connected: true, uid: "uid-t2" });
  });

  it("disconnect stops the runner and signs out", async () => {
    const { rh, runnerAt, signOutCount } = makeHarness();
    await rh.connect("t1");
    const status = await rh.disconnect();
    assert.equal(runnerAt(0).stopped, true);
    assert.equal(signOutCount(), 1);
    assert.deepEqual(status, { connected: false, uid: null });
  });

  it("reconciles status to disconnected when the listener dies fatally", async () => {
    const { rh, runnerAt } = makeHarness();
    await rh.connect("t1");
    assert.equal(rh.status().connected, true);
    // Simulate hostRunner's fatal-listener path invoking onClosed.
    runnerAt(0).onClosed?.();
    assert.equal(rh.status().connected, false);
    // A fresh connect still works after a fatal death.
    await rh.connect("t2");
    assert.deepEqual(rh.status(), { connected: true, uid: "uid-t2" });
  });

  it("threads deps.onExpire into the runner options", async () => {
    const onExpire = () => undefined;
    const { rh, runnerAt } = makeHarness(onExpire);
    await rh.connect("t1");
    assert.equal(runnerAt(0).onExpire, onExpire);
  });

  it("onClosed from a superseded runner does not clear the current one", async () => {
    const { rh, runnerAt } = makeHarness();
    await rh.connect("t1"); // runner 0
    await rh.connect("t2"); // runner 1 (runner 0 stopped)
    runnerAt(0).onClosed?.(); // stale callback from the superseded runner
    assert.deepEqual(rh.status(), { connected: true, uid: "uid-t2" });
    runnerAt(1).onClosed?.(); // the live runner dies
    assert.equal(rh.status().connected, false);
  });
});

// A host whose id depends on what the account already has (mulmoterminal#3092) decides it
// once signed in, through `resolveHostId`; without one the fixed `hostId` is used as before.
describe("createRemoteHost resolveHostId", () => {
  it("binds the runner to the id resolved for the signed-in uid", async () => {
    const asked: string[] = [];
    const resolveHostId = async (uid: string) => {
      asked.push(uid);
      return `${HOST_ID}-0000ffff`;
    };
    const { rh, runnerAt } = makeHarness(undefined, { resolveHostId });
    await rh.connect("t1");
    assert.deepEqual(asked, ["uid-t1"]);
    assert.deepEqual(runnerAt(0).channel, { uid: "uid-t1", hostId: `${HOST_ID}-0000ffff` });
  });

  it("resolves again on reconnect, for the restored uid", async () => {
    const resolveHostId = async (uid: string) => `id-for-${uid}`;
    const restore = async (blob: string) => `uid-${blob}`;
    const { rh, runnerAt } = makeHarness(undefined, { resolveHostId, restore });
    await rh.reconnect("r1");
    assert.deepEqual(runnerAt(0).channel, { uid: "uid-r1", hostId: "id-for-uid-r1" });
  });
});

// resolveHostId runs after signIn/restore has replaced the session, so a failure there
// cannot leave the old runner looking connected, and a lookup that never answers cannot
// hold the serialized transitions forever.
describe("createRemoteHost resolveHostId failures", () => {
  it("a failed resolution starts no runner, and stops the old one whose session was replaced", async () => {
    let fail = false;
    const resolveHostId = async () => {
      if (fail) throw new Error("hosts doc unreadable");
      return HOST_ID;
    };
    const { rh, runners, runnerAt } = makeHarness(undefined, { resolveHostId });
    await rh.connect("t1");
    fail = true;
    await assert.rejects(rh.connect("t2"), /hosts doc unreadable/);
    assert.equal(runners.length, 1);
    assert.equal(runnerAt(0).stopped, true);
    assert.equal(rh.status().connected, false);
  });

  it("a resolver that throws instead of rejecting is handled the same way", async () => {
    let fail = false;
    const resolveHostId = (): Promise<string> => {
      if (fail) throw new Error("thrown synchronously");
      return Promise.resolve(HOST_ID);
    };
    const { rh, runnerAt } = makeHarness(undefined, { resolveHostId });
    await rh.connect("t1");
    fail = true;
    await assert.rejects(rh.connect("t2"), /thrown synchronously/);
    assert.equal(runnerAt(0).stopped, true);
    assert.equal(rh.status().connected, false);
  });

  it("a resolution that never answers times out, and a later disconnect still runs", async () => {
    const resolveHostId = () => new Promise<string>(() => undefined);
    const { rh, runners, signOutCount } = makeHarness(undefined, { resolveHostId, resolveHostIdTimeoutMs: 5 });
    await assert.rejects(rh.connect("t1"), /resolveHostId did not answer/);
    assert.equal(runners.length, 0);
    assert.deepEqual(await rh.disconnect(), { connected: false, uid: null });
    assert.equal(signOutCount(), 1);
  });
});
