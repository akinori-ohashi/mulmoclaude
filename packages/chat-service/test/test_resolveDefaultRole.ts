// Unit tests for the per-bridge default-role resolver.
// Covers the absence / unknown-role / happy-path branches without
// spinning up the relay or a real role registry — getRole is a
// trivial mock.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDefaultRole } from "../src/relay.js";
import type { Logger, Role } from "../src/types.js";

/** `items[index]` is `T | undefined` under `noUncheckedIndexedAccess`. Asserting
 *  states the precondition each case already relies on — the length was just
 *  checked, or the collector was asked for exactly this many — and names the
 *  failure instead of throwing on a property of undefined. */
const elementAt = <T>(items: readonly T[], index: number): T => {
  const item = items[index];
  assert.ok(item !== undefined, `expected an element at index ${index}, but the list holds ${items.length}`);
  return item;
};

// This package's `Role` is `{ id, name }`; the host's is richer. The resolver
// only ever compares `.id`, so the fixture carries what the contract declares
// rather than fields nothing here reads.
const KNOWN_ROLES: Role[] = [
  { id: "general", name: "General" },
  { id: "slack", name: "Slack" },
];

// `getRole` in the host app silently returns the first built-in
// when the id doesn't match — the resolver has to detect that
// case by comparing the returned `.id` back to the input.
function makeGetRole(roles: Role[]): (roleId: string) => Role {
  const [firstBuiltIn] = roles;
  assert.ok(firstBuiltIn !== undefined, "makeGetRole needs at least one role to fall back to");
  return (roleId: string) => roles.find((role) => role.id === roleId) ?? firstBuiltIn;
}

interface Captured {
  level: "error" | "warn" | "info" | "debug";
  msg: string;
  data?: Record<string, unknown> | undefined;
}

function makeLogger(): { logger: Logger; captured: Captured[] } {
  const captured: Captured[] = [];
  const record = (level: Captured["level"]) => (_prefix: string, msg: string, data?: Record<string, unknown>) => {
    captured.push({ level, msg, data });
  };
  return {
    captured,
    logger: {
      error: record("error"),
      warn: record("warn"),
      info: record("info"),
      debug: record("debug"),
    },
  };
}

describe("resolveDefaultRole", () => {
  it("returns the host-app fallback when bridgeOptions is undefined", () => {
    const { logger } = makeLogger();
    const out = resolveDefaultRole(undefined, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "general");
  });

  it("returns the fallback when bridgeOptions is empty", () => {
    const { logger } = makeLogger();
    const out = resolveDefaultRole({}, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "general");
  });

  it("uses bridgeOptions.defaultRole when it names a known role", () => {
    const { logger, captured } = makeLogger();
    const out = resolveDefaultRole({ defaultRole: "slack" }, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "slack");
    // Happy path must not log a warn — noise would make the actual
    // typo case harder to spot in logs.
    assert.equal(captured.filter((entry) => entry.level === "warn").length, 0);
  });

  it("falls back + warn-logs when defaultRole names an unknown role", () => {
    const { logger, captured } = makeLogger();
    const out = resolveDefaultRole({ defaultRole: "not-a-role" }, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "general");
    const warns = captured.filter((entry) => entry.level === "warn");
    assert.equal(warns.length, 1);
    assert.equal(elementAt(warns, 0).data?.requested, "not-a-role");
    assert.equal(elementAt(warns, 0).data?.transportId, "slack");
    assert.equal(elementAt(warns, 0).data?.fallback, "general");
  });

  it("ignores non-string defaultRole values without throwing", () => {
    const { logger } = makeLogger();
    // The type now narrows the bag to primitives, but numbers /
    // booleans still sneak in if a bridge author mis-reads their
    // own config. Double-cast to simulate the runtime shape a
    // non-TS consumer might send (`null`, `{}`) and assert
    // resolveDefaultRole is still fail-safe in those cases.
    // Numbers first — type-compatible post-narrowing.
    assert.equal(resolveDefaultRole({ defaultRole: 123 }, makeGetRole(KNOWN_ROLES), "general", logger, "slack"), "general");
    assert.equal(resolveDefaultRole({ defaultRole: true }, makeGetRole(KNOWN_ROLES), "general", logger, "slack"), "general");
    // Now the out-of-type shapes (would-be-blocked by sanitise
    // upstream, but the resolver must still be defensive).
    assert.equal(resolveDefaultRole({ defaultRole: null as unknown as string }, makeGetRole(KNOWN_ROLES), "general", logger, "slack"), "general");
    assert.equal(resolveDefaultRole({ defaultRole: {} as unknown as string }, makeGetRole(KNOWN_ROLES), "general", logger, "slack"), "general");
  });

  it("treats empty-string defaultRole as absence (no warn)", () => {
    const { logger, captured } = makeLogger();
    const out = resolveDefaultRole({ defaultRole: "" }, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "general");
    // Empty string is "nothing was set", not "user made a typo" —
    // no warn log expected.
    assert.equal(captured.filter((entry) => entry.level === "warn").length, 0);
  });
});
