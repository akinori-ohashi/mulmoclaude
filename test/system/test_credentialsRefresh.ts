// Wiring tests for the credential refresh flow: every `renewViaCli` call is a
// billed Claude session (#3309), so these count how often it is launched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCredentialsRefresher, type CredentialsRefreshIo } from "../../server/system/credentialsRefresh.js";
import { MAX_CONSECUTIVE_RENEWAL_FAILURES, RENEWAL_RETRY_COOLDOWN_MS } from "../../server/system/credentialsState.js";

const START_MS = Date.parse("2026-09-26T00:00:00Z");
const ONE_HOUR_MS = 3_600_000;

function blob(oauth: Record<string, unknown>): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat", refreshToken: "sk-ant-ort", expiresAt: START_MS + ONE_HOUR_MS, ...oauth } });
}

const EXPIRED = blob({ expiresAt: START_MS - ONE_HOUR_MS });
const EMPTY_ITEM = JSON.stringify({ claudeAiOauth: { accessToken: "", refreshToken: "", expiresAt: 0, scopes: [] } });

interface FakeRefreshIo extends CredentialsRefreshIo {
  renewals: number;
  written: string[];
  clockMs: number;
}

/** Keychain returns `keychain[i]` on the i-th read (the last entry repeats); the CLI "responds" with `renewResponds`. */
function makeFakeRefreshIo(keychain: (string | null)[], renewResponds = true): FakeRefreshIo {
  let reads = 0;
  const fakeRefreshIo: FakeRefreshIo = {
    renewals: 0,
    written: [],
    clockMs: START_MS,
    readKeychain: async () => keychain[Math.min(reads++, keychain.length - 1)] ?? null,
    renewViaCli: async () => {
      fakeRefreshIo.renewals += 1;
      return renewResponds;
    },
    writeCredentials: async (credentials) => {
      fakeRefreshIo.written.push(credentials);
    },
    nowMs: () => fakeRefreshIo.clockMs,
  };
  return fakeRefreshIo;
}

describe("createCredentialsRefresher", () => {
  it("writes a valid token without launching the CLI", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([blob({})]);
    assert.equal(await createCredentialsRefresher(fakeRefreshIo)(), true);
    assert.equal(fakeRefreshIo.renewals, 0);
    assert.deepEqual(fakeRefreshIo.written, [blob({})]);
  });

  // The #3309 loop: an empty Keychain item used to launch a session on every call.
  it("never launches the CLI for credentials no renewal can fix", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EMPTY_ITEM]);
    const refresh = createCredentialsRefresher(fakeRefreshIo);
    for (let call = 0; call < 5; call += 1) assert.equal(await refresh(), false);
    assert.equal(fakeRefreshIo.renewals, 0);
    assert.deepEqual(fakeRefreshIo.written, []);
  });

  it("does not launch the CLI when the Keychain has nothing", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([null]);
    assert.equal(await createCredentialsRefresher(fakeRefreshIo)(), false);
    assert.equal(fakeRefreshIo.renewals, 0);
  });

  it("renews an expired token once and writes the fresh one", async () => {
    const fresh = blob({});
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED, fresh]);
    assert.equal(await createCredentialsRefresher(fakeRefreshIo)(), true);
    assert.equal(fakeRefreshIo.renewals, 1);
    assert.deepEqual(fakeRefreshIo.written, [fresh]);
  });

  it("does not write when the Keychain is still expired after the CLI responded", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED]);
    assert.equal(await createCredentialsRefresher(fakeRefreshIo)(), false);
    assert.equal(fakeRefreshIo.renewals, 1);
    assert.deepEqual(fakeRefreshIo.written, []);
  });

  it("waits out the cooldown before launching the CLI again", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED], false);
    const refresh = createCredentialsRefresher(fakeRefreshIo);
    await refresh();
    await refresh();
    assert.equal(fakeRefreshIo.renewals, 1);
    fakeRefreshIo.clockMs += RENEWAL_RETRY_COOLDOWN_MS;
    await refresh();
    assert.equal(fakeRefreshIo.renewals, 2);
  });

  it("stops launching the CLI after the maximum consecutive failures", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED], false);
    const refresh = createCredentialsRefresher(fakeRefreshIo);
    for (let call = 0; call < MAX_CONSECUTIVE_RENEWAL_FAILURES + 5; call += 1) {
      await refresh();
      fakeRefreshIo.clockMs += RENEWAL_RETRY_COOLDOWN_MS;
    }
    assert.equal(fakeRefreshIo.renewals, MAX_CONSECUTIVE_RENEWAL_FAILURES);
  });

  it("starts renewing again after a fresh login clears the failures", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED], false);
    const refresh = createCredentialsRefresher(fakeRefreshIo);
    for (let call = 0; call < MAX_CONSECUTIVE_RENEWAL_FAILURES; call += 1) {
      await refresh();
      fakeRefreshIo.clockMs += RENEWAL_RETRY_COOLDOWN_MS;
    }
    const keychain = [blob({ expiresAt: fakeRefreshIo.clockMs + ONE_HOUR_MS }), EXPIRED];
    let reads = 0;
    fakeRefreshIo.readKeychain = async () => keychain[Math.min(reads++, keychain.length - 1)] ?? null;
    assert.equal(await refresh(), true);
    await refresh();
    assert.equal(fakeRefreshIo.renewals, MAX_CONSECUTIVE_RENEWAL_FAILURES + 1);
  });

  it("counts a renewal that throws toward the cap", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED]);
    fakeRefreshIo.renewViaCli = async () => {
      fakeRefreshIo.renewals += 1;
      throw new Error("posix_spawnp failed");
    };
    const refresh = createCredentialsRefresher(fakeRefreshIo);
    for (let call = 0; call < MAX_CONSECUTIVE_RENEWAL_FAILURES + 5; call += 1) {
      assert.equal(await refresh(), false);
      fakeRefreshIo.clockMs += RENEWAL_RETRY_COOLDOWN_MS;
    }
    assert.equal(fakeRefreshIo.renewals, MAX_CONSECUTIVE_RENEWAL_FAILURES);
  });

  it("counts a Keychain read that throws after the CLI ran toward the cap", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED]);
    let reads = 0;
    fakeRefreshIo.readKeychain = async () => {
      reads += 1;
      if (reads % 2 === 0) throw new Error("security exited 44");
      return EXPIRED;
    };
    const refresh = createCredentialsRefresher(fakeRefreshIo);
    for (let call = 0; call < MAX_CONSECUTIVE_RENEWAL_FAILURES + 5; call += 1) {
      await refresh();
      fakeRefreshIo.clockMs += RENEWAL_RETRY_COOLDOWN_MS;
    }
    assert.equal(fakeRefreshIo.renewals, MAX_CONSECUTIVE_RENEWAL_FAILURES);
  });

  it("launches the CLI once for concurrent calls", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED], false);
    const refresh = createCredentialsRefresher(fakeRefreshIo);
    const results = await Promise.all([refresh(), refresh(), refresh()]);
    assert.deepEqual(results, [false, false, false]);
    assert.equal(fakeRefreshIo.renewals, 1);
  });

  it("reports false instead of throwing when the Keychain read fails", async () => {
    const fakeRefreshIo = makeFakeRefreshIo([EXPIRED]);
    fakeRefreshIo.readKeychain = async () => {
      throw new Error("security exited 44");
    };
    assert.equal(await createCredentialsRefresher(fakeRefreshIo)(), false);
    assert.equal(fakeRefreshIo.renewals, 0);
  });
});
