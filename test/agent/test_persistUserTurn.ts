// #3162. The first-turn model carry is applied by ONE line inside
// `persistUserTurn`, and deleting it left the entire suite green — the only
// thing covering it was a run against the real CLI, which proves the code
// worked once but does not stop a regression.
//
// `startChat` cannot be driven in-process (it needs a real `~/.claude`
// install), but `persistUserTurn` can: it touches only files and pub/sub. The
// module is imported AFTER HOME/workspace are redirected, because the session
// IO resolves the workspace from the environment at call time — the same shape
// `test_buildAgentInput.ts` uses.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatModel } from "../../src/config/models.js";

type AgentRoutes = typeof import("../../server/api/routes/agent.js");
type SessionIo = typeof import("../../server/utils/files/session-io.js");

let root: string;
let originalHome: string | undefined;
let originalWorkspace: string | undefined;
let routes: AgentRoutes;
let sessionIo: SessionIo;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mulmo-persist-user-turn-"));
  originalHome = process.env.HOME;
  originalWorkspace = process.env.MULMOCLAUDE_WORKSPACE_PATH;
  process.env.HOME = root;
  process.env.MULMOCLAUDE_WORKSPACE_PATH = root;
  await mkdir(path.join(root, "conversations", "chat"), { recursive: true });
  await mkdir(path.join(root, "config"), { recursive: true });
  routes = await import("../../server/api/routes/agent.js");
  sessionIo = await import("../../server/utils/files/session-io.js");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalWorkspace === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
  else process.env.MULMOCLAUDE_WORKSPACE_PATH = originalWorkspace;
  await rm(root, { recursive: true, force: true });
});

const turn = async (chatSessionId: string, isFirstTurn: boolean, chatModel?: unknown): Promise<void> => {
  await routes.persistUserTurn(
    { message: "hello", roleId: "general", chatSessionId, ...(chatModel === undefined ? {} : { chatModel }) },
    { isFirstTurn, attachedFiles: [] },
  );
};

const storedChatModel = async (chatSessionId: string): Promise<ChatModel | undefined> => (await sessionIo.readSessionMeta(chatSessionId))?.chatModel;

describe("persistUserTurn — the first-turn model carry", () => {
  // The rule the one line exists for. A session is minted in the browser, so
  // there is no sidecar for the chat-model route to write to until the line
  // above this one creates it; the choice therefore rides with the request.
  it("stores a known alias from the request on the first turn", async () => {
    await turn("carry-1", true, "haiku");
    assert.equal(await storedChatModel("carry-1"), "haiku");
  });

  it("stores nothing when the request carries no model", async () => {
    await turn("carry-2", true);
    assert.equal(await storedChatModel("carry-2"), undefined);
    assert.equal("chatModel" in ((await sessionIo.readSessionMeta("carry-2")) ?? {}), false, "absent must leave the key off the file, not write undefined");
  });

  // The sidecar is authoritative after the first turn. Taking the request's
  // copy later would let a tab that has been open for an hour undo a choice
  // made in another one a second ago.
  it("ignores the request's model on a later turn", async () => {
    await turn("carry-3", true, "haiku");
    await turn("carry-3", false, "opus");
    assert.equal(await storedChatModel("carry-3"), "haiku", "a later turn must not take the model off the request");
  });

  it("leaves a session with no override alone on a later turn", async () => {
    await turn("carry-4", true);
    await turn("carry-4", false, "opus");
    assert.equal(await storedChatModel("carry-4"), undefined);
  });

  // The end-state guarantee: an alias the app does not know never ends up
  // configured. Worth pinning, but be clear about what it does NOT pin — the
  // `isChatModel` check at this call site is defence in depth, and removing it
  // leaves these two green. Measured: with BOTH it and the `updateSessionChatModel`
  // guard removed, `"chatModel": "gpt-4o"` really is written to the file — and
  // then `incrementUserQueryCount`, the very next read-modify-write in this
  // function, launders it back out, because the read drops an unknown alias
  // before the write puts the rest of the object back. The layer that refuses a
  // stored alias is pinned in `test/utils/files/test_session_io.ts`, against the
  // raw file, which is the only place the two mechanisms can be told apart.
  it("refuses an alias the app does not know", async () => {
    await turn("carry-5", true, "gpt-4o");
    assert.equal(await storedChatModel("carry-5"), undefined);
    const raw = await readFile(sessionIo.sessionMetaAbsPath("carry-5") ?? "", "utf-8");
    assert.equal(raw.includes("gpt-4o"), false, "an unknown alias must not survive the turn on disk");
  });

  it("refuses a non-string, including shapes that could confuse a validator", async () => {
    const hostile: unknown[] = [42, true, {}, [], null, { toString: () => "haiku" }];
    await Promise.all(hostile.map((value, index) => turn(`carry-bad-${index}`, true, value)));
    const stored = await Promise.all(hostile.map((_unused, index) => storedChatModel(`carry-bad-${index}`)));
    assert.deepEqual(
      stored,
      hostile.map(() => undefined),
    );
  });

  // The carry must not cost the rest of the turn: the sidecar, the counter and
  // the transcript all still have to be written.
  it("still writes the rest of the turn alongside the carry", async () => {
    await turn("carry-6", true, "opus");
    const meta = await sessionIo.readSessionMeta("carry-6");
    assert.equal(meta?.roleId, "general");
    assert.equal(meta?.firstUserMessage, "hello");
    assert.equal(meta?.userQueryCount, 1);
    assert.equal(meta?.chatModel, "opus");
    assert.match((await sessionIo.readSessionJsonl("carry-6")) ?? "", /"message":"hello"/);
  });
});
