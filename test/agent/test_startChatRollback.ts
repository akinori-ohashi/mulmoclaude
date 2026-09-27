// A `startChat` that fails AFTER `beginRun` must hand the session back. The
// failure is forced inside `persistUserTurn` (the transcript path is occupied by
// a directory, so the append throws EISDIR), which is before any CLI is spawned —
// so this runs in-process without a `~/.claude` install. Modules are imported
// after HOME/workspace are redirected, as in `test_persistUserTurn.ts`.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type AgentRoutes = typeof import("../../server/api/routes/agent.js");
type SessionStore = typeof import("../../server/events/session-store/index.js");

let root: string;
let originalHome: string | undefined;
let originalWorkspace: string | undefined;
let routes: AgentRoutes;
let sessionStore: SessionStore;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mulmo-startchat-rollback-"));
  originalHome = process.env.HOME;
  originalWorkspace = process.env.MULMOCLAUDE_WORKSPACE_PATH;
  process.env.HOME = root;
  process.env.MULMOCLAUDE_WORKSPACE_PATH = root;
  await mkdir(path.join(root, "conversations", "chat"), { recursive: true });
  await mkdir(path.join(root, "config"), { recursive: true });
  routes = await import("../../server/api/routes/agent.js");
  sessionStore = await import("../../server/events/session-store/index.js");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalWorkspace === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
  else process.env.MULMOCLAUDE_WORKSPACE_PATH = originalWorkspace;
  await rm(root, { recursive: true, force: true });
});

const blockTranscript = async (chatSessionId: string): Promise<void> => {
  await mkdir(path.join(root, "conversations", "chat", `${chatSessionId}.jsonl`), { recursive: true });
};

describe("startChat — a failure after beginRun rolls the run back", () => {
  it("reports an error instead of rejecting", async () => {
    await blockTranscript("rollback-1");
    const result = await routes.startChat({ message: "hello", roleId: "general", chatSessionId: "rollback-1" });
    assert.equal(result.kind, "error");
    assert.equal(result.kind === "error" ? result.status : undefined, 500);
  });

  it("leaves the session not running, so the next turn is not refused with 409", async () => {
    await blockTranscript("rollback-2");
    await routes.startChat({ message: "hello", roleId: "general", chatSessionId: "rollback-2" }).catch(() => undefined);
    const session = sessionStore.getSession("rollback-2");
    assert.equal(session?.isRunning, false);
    assert.equal(session?.abortRun, undefined, "the rolled-back run must not stay cancellable");
  });
});
