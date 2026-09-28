// applySessionSummary carries the loop body `refreshSessionStates` used to
// inline (proved equivalent to it on every input combination when extracted),
// plus the new signal: true exactly when a session flips running → stopped.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SessionSummary } from "../../../src/types/session.js";
import { applySessionSummary, type LiveSessionState } from "../../../src/utils/session/applySessionSummary.js";

function summaryWith(fields: Partial<Pick<SessionSummary, "isRunning" | "statusMessage" | "hasUnread">>): SessionSummary {
  return { id: "s1", roleId: "general", startedAt: "", updatedAt: "", preview: "", ...fields };
}

interface SummaryCase {
  wasRunning: boolean;
  wasUnread: boolean;
  isRunning: boolean | undefined;
  hasUnread: boolean | undefined;
  statusMessage: string | undefined;
  isCurrentSession: boolean;
}

const BOOLS = [true, false];
const OPTIONAL_BOOLS = [true, false, undefined];
const MESSAGES = ["", "Thinking...", undefined];

/** Every combination of prior client state, server summary and focus. */
function allCases(): SummaryCase[] {
  const priors = BOOLS.flatMap((wasRunning) => BOOLS.map((wasUnread) => ({ wasRunning, wasUnread })));
  const servers = OPTIONAL_BOOLS.flatMap((isRunning) =>
    OPTIONAL_BOOLS.flatMap((hasUnread) => MESSAGES.map((statusMessage) => ({ isRunning, hasUnread, statusMessage }))),
  );
  return priors.flatMap((prior) => servers.flatMap((server) => BOOLS.map((isCurrentSession) => ({ ...prior, ...server, isCurrentSession }))));
}

function checkCase(testCase: SummaryCase): void {
  const { wasRunning, wasUnread, isRunning, hasUnread, statusMessage, isCurrentSession } = testCase;
  const live: LiveSessionState = { isRunning: wasRunning, statusMessage: "old", hasUnread: wasUnread };
  const fields = {
    ...(isRunning === undefined ? {} : { isRunning }),
    ...(hasUnread === undefined ? {} : { hasUnread }),
    ...(statusMessage === undefined ? {} : { statusMessage }),
  };
  const stopped = applySessionSummary(live, summaryWith(fields), isCurrentSession);
  const context = JSON.stringify(testCase);
  assert.equal(live.isRunning, isRunning ?? false, context);
  assert.equal(live.statusMessage, statusMessage ?? "", context);
  const keepsBadgeOff = (hasUnread ?? false) && isCurrentSession;
  assert.equal(live.hasUnread, keepsBadgeOff ? wasUnread : (hasUnread ?? false), context);
  assert.equal(stopped, wasRunning && !(isRunning ?? false), context);
}

describe("applySessionSummary — every combination", () => {
  it("applies the server state and reports only running → stopped", () => {
    const cases = allCases();
    assert.equal(cases.length, BOOLS.length ** 3 * OPTIONAL_BOOLS.length ** 2 * MESSAGES.length);
    cases.forEach(checkCase);
  });
});
