import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCommandHandler, parseSkillShortcut } from "../src/commands.ts";
import type { TransportChatState } from "../src/chat-state.ts";
import type { SessionSummary } from "../src/types.ts";

// Named rather than indexed: every fallback below means "the general role",
// not "whatever happens to be first", and a named binding is also not
// `T | undefined` the way `generalRole` is under `noUncheckedIndexedAccess`.
const generalRole = { id: "general", name: "General" };
const officeRole = { id: "office", name: "Office" };
const roles = [generalRole, officeRole];

function makeState(overrides?: Partial<TransportChatState>): TransportChatState {
  return {
    externalChatId: "test-chat",
    sessionId: "sess-1",
    roleId: "general",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockSessions: SessionSummary[] = [
  {
    id: "s1",
    roleId: "general",
    preview: "First session",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "s2",
    roleId: "office",
    preview: "Second session",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "s3",
    roleId: "general",
    preview: "Third session",
    updatedAt: new Date().toISOString(),
  },
];

const mockMessages = [
  { source: "user", text: "Hello" },
  { source: "assistant", text: "Hi there!" },
  { source: "user", text: "What is 2+2?" },
  { source: "assistant", text: "4" },
  { source: "user", text: "Thanks" },
  { source: "assistant", text: "You're welcome" },
];

describe("/sessions command", () => {
  it("lists sessions with page info", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listSessions: async ({ limit, offset }) => ({
        sessions: mockSessions.slice(offset, offset + limit),
        total: mockSessions.length,
      }),
    });
    const result = await handler("/sessions", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("First session"));
    assert.ok(result.reply.includes("total 3"));
  });

  it("returns not available when listSessions is not provided", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/sessions", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("not available"));
  });
});

describe("/switch command", () => {
  it("switches to a session from the list", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async (_t, _c, sessionId) => makeState({ sessionId }),
      listSessions: async ({ limit, offset }) => ({
        sessions: mockSessions.slice(offset, offset + limit),
        total: mockSessions.length,
      }),
    });
    // First call /sessions to populate cache
    await handler("/sessions", "telegram", makeState());
    // Then switch
    const result = await handler("/switch 2", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Second session"));
    assert.ok(result.nextState);
  });

  it("treats non-digit argument as session ID (not found)", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/switch abc", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("not found"));
  });

  it("propagates the target session's roleId when switching by number (regression, issue #1888)", async () => {
    // Bridge state currently uses "general"; the target session (mockSessions[1] = s2)
    // is under "office". Before the fix, connectSession only received the sessionId
    // so the persisted state kept roleId="general" and the next relay's startChat
    // ran the resumed office session under the general role.
    const capturedArgs: { sessionId?: string | undefined; roleId?: string | undefined } = {};
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      // Mock mirrors the real chat-state.ts behaviour: when roleId is passed,
      // stamp it into the returned state; otherwise preserve the incoming role.
      connectSession: async (_t, _c, sessionId, roleId) => {
        capturedArgs.sessionId = sessionId;
        capturedArgs.roleId = roleId;
        return makeState({ sessionId, ...(roleId !== undefined ? { roleId } : {}) });
      },
      listSessions: async ({ limit, offset }) => ({
        sessions: mockSessions.slice(offset, offset + limit),
        total: mockSessions.length,
      }),
    });
    await handler("/sessions", "telegram", makeState());
    const result = await handler("/switch 2", "telegram", makeState({ roleId: "general" }));
    assert.ok(result);
    assert.equal(capturedArgs.sessionId, "s2");
    assert.equal(capturedArgs.roleId, "office", "target session's roleId must reach connectSession");
    assert.ok(result.nextState);
    assert.equal(result.nextState?.roleId, "office", "returned nextState must reflect the target session's role");
    assert.equal(result.nextState?.sessionId, "s2");
  });

  it("propagates the target session's roleId when switching by session ID (non-numeric branch)", async () => {
    // Same bug shape as the numeric branch, on the `/switch <sessionId>` path
    // (commands.ts line ~259). Covering both branches so a future refactor
    // that only fixes one is caught.
    const capturedArgs: { sessionId?: string | undefined; roleId?: string | undefined } = {};
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async (_t, _c, sessionId, roleId) => {
        capturedArgs.sessionId = sessionId;
        capturedArgs.roleId = roleId;
        return makeState({ sessionId, ...(roleId !== undefined ? { roleId } : {}) });
      },
      listSessions: async ({ limit, offset }) => ({
        sessions: mockSessions.slice(offset, offset + limit),
        total: mockSessions.length,
      }),
    });
    await handler("/sessions", "telegram", makeState());
    const result = await handler("/switch s2", "telegram", makeState({ roleId: "general" }));
    assert.ok(result);
    assert.equal(capturedArgs.roleId, "office");
    assert.equal(result.nextState?.roleId, "office");
    assert.equal(result.nextState?.sessionId, "s2");
  });

  it("per-chat cache isolation", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async (_t, _c, sessionId) => makeState({ sessionId }),
      listSessions: async ({ limit, offset }) => ({
        sessions: mockSessions.slice(offset, offset + limit),
        total: mockSessions.length,
      }),
    });
    // User A populates cache
    await handler("/sessions", "telegram", makeState({ externalChatId: "userA" }));
    // User B has NOT called /sessions — /switch should fail
    const result = await handler("/switch 1", "telegram", makeState({ externalChatId: "userB" }));
    assert.ok(result);
    assert.ok(result.reply.includes("/sessions first"));
  });
});

describe("/history command", () => {
  it("shows recent messages", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      getSessionHistory: async (_sid, { limit, offset }) => ({
        messages: mockMessages.slice(offset, offset + limit),
        total: mockMessages.length,
      }),
    });
    const result = await handler("/history", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Hello"));
    assert.ok(result.reply.includes("page 1/"));
  });

  it("returns not available when getSessionHistory is not provided", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/history", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("not available"));
  });

  it("supports pagination", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      getSessionHistory: async (_sid, { limit, offset }) => ({
        messages: mockMessages.slice(offset, offset + limit),
        total: mockMessages.length,
      }),
    });
    const page2 = await handler("/history 2", "telegram", makeState());
    assert.ok(page2);
    // Page 2 should have the 6th message (index 5)
    assert.ok(page2.reply.includes("welcome"));
  });
});

describe("unknown slash command", () => {
  it("rejects an unknown slash with help text when no skill list is wired", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/foo", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Unknown command: /foo"));
  });

  it("forwards to the agent (returns null) when the slash names a registered skill", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "shiritori", description: "Play shiritori" }],
    });
    const result = await handler("/shiritori", "telegram", makeState());
    assert.equal(result, null);
  });

  it("rejects an unregistered slash even when a skill list is wired", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "shiritori", description: "Play shiritori" }],
    });
    const result = await handler("/notaskill", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Unknown command: /notaskill"));
  });

  it("treats bare `/` as unknown (slice produces empty string, list ignored)", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      // Even a permissive list must NOT match the empty skill name.
      listRegisteredSkills: async () => [{ name: "", description: "wat" }],
    });
    const result = await handler("/", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Unknown command: /"));
  });

  it("includes registered skills in the unknown-command help footer", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [
        { name: "shiritori", description: "Play shiritori" },
        { name: "haiku", description: "Compose a haiku" },
      ],
    });
    const result = await handler("/foo", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Skills:"));
    assert.ok(result.reply.includes("/shiritori — Play shiritori"));
    assert.ok(result.reply.includes("/haiku — Compose a haiku"));
  });
});

describe("parseSkillShortcut (pure helper)", () => {
  it("returns skill name and empty args for a bare `//skill`", () => {
    assert.deepEqual(parseSkillShortcut("//mag2"), { skillName: "mag2", argsVerbatim: "" });
  });

  it("splits at the first whitespace and preserves args verbatim", () => {
    assert.deepEqual(parseSkillShortcut("//mag2 https://x.com/post"), { skillName: "mag2", argsVerbatim: "https://x.com/post" });
  });

  it("collapses the leading separator run while preserving doubled whitespace inside args", () => {
    // Two-space separator before first arg → drop both. Internal
    // doubled spaces between subsequent tokens stay verbatim.
    assert.deepEqual(parseSkillShortcut("//mag2  url  with  spaces"), { skillName: "mag2", argsVerbatim: "url  with  spaces" });
  });

  it("preserves tabs and newlines inside the args", () => {
    assert.deepEqual(parseSkillShortcut("//mag2 line one\n\nline two\twith tab"), {
      skillName: "mag2",
      argsVerbatim: "line one\n\nline two\twith tab",
    });
  });

  it("collapses a CRLF separator (Codex iter-1 — Windows-style paste)", () => {
    // Input from a Windows clipboard / Telegram desktop client. The
    // \r\n is one logical line break between skill name and args;
    // dropping only \r would leave an orphan \n at the head of args.
    assert.deepEqual(parseSkillShortcut("//mag2\r\nurl"), { skillName: "mag2", argsVerbatim: "url" });
  });

  it("returns an empty skill name for bare `//`", () => {
    assert.deepEqual(parseSkillShortcut("//"), { skillName: "", argsVerbatim: "" });
  });

  it("returns an empty skill name for `// args` (caller treats empty skill as unknown)", () => {
    assert.deepEqual(parseSkillShortcut("// args"), { skillName: "", argsVerbatim: "args" });
  });
});

describe("//{skill} shortcut", () => {
  it("returns forwardAs and resets state when the skill is registered", async () => {
    const resetCalls: Array<{ transportId: string; chatId: string; roleId: string }> = [];
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? generalRole,
      resetChatState: async (transportId, chatId, roleId) => {
        resetCalls.push({ transportId, chatId, roleId });
        return makeState({ roleId, sessionId: "sess-new" });
      },
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "shiritori", description: "Play shiritori" }],
    });
    const result = await handler("//shiritori", "telegram", makeState({ roleId: "office" }));
    assert.ok(result);
    assert.equal(result.forwardAs, "/shiritori");
    assert.ok(result.nextState);
    assert.equal(result.nextState?.sessionId, "sess-new");
    assert.equal(resetCalls.length, 1);
    const resetCall = resetCalls[0];
    assert.ok(resetCall !== undefined, "expected resetChatState to have been called");
    assert.equal(resetCall.roleId, "office");
  });

  it("rejects // with a skill that is not registered", async () => {
    let resetCalled = false;
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => {
        resetCalled = true;
        return makeState({ roleId });
      },
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "shiritori", description: "Play shiritori" }],
    });
    const result = await handler("//notaskill", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, undefined);
    assert.ok(result.reply.includes("Unknown command: //notaskill"));
    assert.equal(resetCalled, false);
  });

  it("rejects bare // (empty skill name never matches)", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "", description: "wat" }],
    });
    const result = await handler("//", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, undefined);
    assert.ok(result.reply.includes("Unknown command: //"));
  });

  it("forwards args after the skill name verbatim", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId, sessionId: "sess-new" }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "mag2", description: "Write a newsletter from a URL" }],
    });
    const result = await handler("//mag2 https://example.com/post", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, "/mag2 https://example.com/post");
    assert.equal(result.nextState?.sessionId, "sess-new");
  });

  it("forwards multi-token args after the skill name", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "mag2", description: "Write a newsletter" }],
    });
    const result = await handler("//mag2 https://x.com/u/1 in Japanese", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, "/mag2 https://x.com/u/1 in Japanese");
  });

  it("preserves doubled whitespace and tabs inside the args verbatim", async () => {
    // Earlier implementation used `text.split(/\s+/)` + `rest.join(" ")`
    // which collapsed every whitespace run to a single space. That
    // breaks the "verbatim" promise for payloads that intentionally
    // contain doubled spaces, tabs, or newlines (CodeRabbit on #967).
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId, sessionId: "sess-new" }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "mag2", description: "Write a newsletter from a URL" }],
    });
    const result = await handler("//mag2 line one\n\nline two\twith tab", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, "/mag2 line one\n\nline two\twith tab");
  });

  it("rejects // when no skill list is wired", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("//shiritori", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, undefined);
    assert.ok(result.reply.includes("Unknown command: //shiritori"));
  });
});

describe("/help command", () => {
  it("omits the Skills section when no skill list is wired", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/help", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Commands:"));
    assert.ok(!result.reply.includes("Skills:"));
  });

  it("omits the Skills section when the skill list is empty", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [],
    });
    const result = await handler("/help", "telegram", makeState());
    assert.ok(result);
    assert.ok(!result.reply.includes("Skills:"));
  });

  it("lists registered skills with descriptions in the Skills section", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [
        { name: "shiritori", description: "Play shiritori" },
        { name: "haiku", description: "Compose a haiku" },
      ],
    });
    const result = await handler("/help", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Skills:"));
    assert.ok(result.reply.includes("/shiritori — Play shiritori"));
    assert.ok(result.reply.includes("/haiku — Compose a haiku"));
    assert.ok(result.reply.includes("//<skill>"));
  });

  it("omits the //<skill> tip when no skills are registered", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => generalRole,
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [],
    });
    const result = await handler("/help", "telegram", makeState());
    assert.ok(result);
    assert.ok(!result.reply.includes("//<skill>"));
  });
});
