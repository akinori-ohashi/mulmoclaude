import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createSessionMeta,
  readSessionMeta,
  writeSessionMeta,
  updateHasUnread,
  incrementUserQueryCount,
  backfillFirstUserMessage,
  setClaudeSessionId,
  updateResolvedModel,
  updateSessionChatModel,
  clearClaudeSessionId,
  appendSessionLine,
  readSessionJsonl,
} from "../../../server/utils/files/session-io.js";
import { WORKSPACE_DIRS } from "../../../server/workspace/paths.js";

let root: string;

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "session-io-test-"));
  // Create the chat dir
  mkdirSync(path.join(root, WORKSPACE_DIRS.chat), { recursive: true });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readSessionMeta", () => {
  it("returns null for non-existent session", async () => {
    assert.equal(await readSessionMeta("nonexistent", root), null);
  });

  it("returns null for corrupt JSON (not crash)", async () => {
    const chatDir = path.join(root, WORKSPACE_DIRS.chat);
    writeFileSync(path.join(chatDir, "corrupt.json"), "{broken");
    assert.equal(await readSessionMeta("corrupt", root), null);
  });

  it("round-trips with writeSessionMeta", async () => {
    await writeSessionMeta("rw-test", { roleId: "general" }, root);
    const meta = await readSessionMeta("rw-test", root);
    assert.equal(meta?.roleId, "general");
  });

  it("returns null for JSON whose declared fields have the wrong types", async () => {
    const chatDir = path.join(root, WORKSPACE_DIRS.chat);
    const body = JSON.stringify({ roleId: 5, hasUnread: "yes", origin: "martian" });
    writeFileSync(path.join(chatDir, "bad-shape.json"), body);
    assert.equal(await readSessionMeta("bad-shape", root), null);
    // Every mutator early-returns on null, so an unreadable meta file must
    // stay on disk intact rather than being replaced by a partial rewrite.
    await updateHasUnread("bad-shape", true, root);
    assert.equal(readFileSync(path.join(chatDir, "bad-shape.json"), "utf-8"), body);
  });

  it("keeps keys the type doesn't model, and accepts a plugin origin", async () => {
    const chatDir = path.join(root, WORKSPACE_DIRS.chat);
    writeFileSync(path.join(chatDir, "extra.json"), JSON.stringify({ roleId: "general", origin: "plugin:@scope/pkg", futureField: [1, 2] }));
    const meta = await readSessionMeta("extra", root);
    assert.equal(meta?.origin, "plugin:@scope/pkg");
    assert.deepEqual(meta?.futureField, [1, 2]);
  });
});

describe("createSessionMeta", () => {
  it("creates meta with roleId, startedAt, firstUserMessage", async () => {
    await createSessionMeta("create-test", "office", "hello", root);
    const meta = await readSessionMeta("create-test", root);
    assert.equal(meta?.roleId, "office");
    assert.equal(meta?.firstUserMessage, "hello");
    assert.ok(meta?.startedAt);
  });

  it("creates parent dir if missing", async () => {
    const freshRoot = mkdtempSync(path.join(tmpdir(), "session-io-nodir-"));
    // Don't pre-create chat dir
    await createSessionMeta("nodir-test", "general", "hi", freshRoot);
    const meta = await readSessionMeta("nodir-test", freshRoot);
    assert.equal(meta?.roleId, "general");
    rmSync(freshRoot, { recursive: true, force: true });
  });
});

describe("updateHasUnread", () => {
  it("sets hasUnread on existing meta", async () => {
    await writeSessionMeta("unread-test", { roleId: "general" }, root);
    await updateHasUnread("unread-test", true, root);
    const meta = await readSessionMeta("unread-test", root);
    assert.equal(meta?.hasUnread, true);
  });

  it("no-ops when session meta does not exist", async () => {
    await assert.doesNotReject(updateHasUnread("ghost", false, root));
  });
});

describe("incrementUserQueryCount", () => {
  it("bumps undefined → 1 on the first turn, then 1 → 2", async () => {
    await writeSessionMeta("count-test", { roleId: "general" }, root);
    await incrementUserQueryCount("count-test", root);
    assert.equal((await readSessionMeta("count-test", root))?.userQueryCount, 1);
    await incrementUserQueryCount("count-test", root);
    assert.equal((await readSessionMeta("count-test", root))?.userQueryCount, 2);
  });

  it("no-ops when session meta does not exist", async () => {
    await incrementUserQueryCount("count-ghost", root);
    assert.equal(await readSessionMeta("count-ghost", root), null);
  });

  it("preserves other meta fields", async () => {
    await writeSessionMeta("count-preserve", { roleId: "office", isBookmarked: true }, root);
    await incrementUserQueryCount("count-preserve", root);
    const meta = await readSessionMeta("count-preserve", root);
    assert.equal(meta?.roleId, "office");
    assert.equal(meta?.isBookmarked, true);
    assert.equal(meta?.userQueryCount, 1);
  });
});

describe("backfillFirstUserMessage", () => {
  it("backfills when missing", async () => {
    await writeSessionMeta("backfill-test", { roleId: "general" }, root);
    await backfillFirstUserMessage("backfill-test", "first msg", root);
    const meta = await readSessionMeta("backfill-test", root);
    assert.equal(meta?.firstUserMessage, "first msg");
  });

  it("does not overwrite when already set", async () => {
    await writeSessionMeta("backfill-noop", { roleId: "general", firstUserMessage: "original" }, root);
    await backfillFirstUserMessage("backfill-noop", "replacement", root);
    const meta = await readSessionMeta("backfill-noop", root);
    assert.equal(meta?.firstUserMessage, "original");
  });
});

describe("setClaudeSessionId / clearClaudeSessionId", () => {
  it("sets and clears claudeSessionId", async () => {
    await writeSessionMeta("claude-test", { roleId: "general" }, root);
    await setClaudeSessionId("claude-test", "cs-123", root);
    let meta = await readSessionMeta("claude-test", root);
    assert.equal(meta?.claudeSessionId, "cs-123");

    await clearClaudeSessionId("claude-test", root);
    meta = await readSessionMeta("claude-test", root);
    assert.equal(meta?.claudeSessionId, undefined);
    assert.equal(meta?.roleId, "general"); // other fields preserved
  });
});

describe("appendSessionLine", () => {
  it("appends lines with trailing newline", async () => {
    await appendSessionLine("append-test", '{"a":1}', root);
    await appendSessionLine("append-test", '{"b":2}', root);
    const raw = await readSessionJsonl("append-test", root);
    assert.ok(raw);
    const lines = raw.split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    const [firstLine, secondLine] = lines;
    assert.ok(firstLine);
    assert.ok(secondLine);
    assert.deepEqual(JSON.parse(firstLine), { a: 1 });
    assert.deepEqual(JSON.parse(secondLine), { b: 2 });
  });

  it("normalizes missing trailing newline", async () => {
    await appendSessionLine("nl-test", "line-without-nl", root);
    await appendSessionLine("nl-test", "line-with-nl\n", root);
    const raw = await readSessionJsonl("nl-test", root);
    assert.ok(raw);
    // Both should end up as separate lines
    const lines = raw.split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "line-without-nl");
    assert.equal(lines[1], "line-with-nl");
  });

  it("does not double-newline when caller already includes \\n", async () => {
    await appendSessionLine("double-nl", "data\n", root);
    const raw = await readSessionJsonl("double-nl", root);
    assert.ok(raw);
    assert.equal(raw, "data\n");
    // NOT "data\n\n"
  });
});

describe("readSessionJsonl", () => {
  it("returns null for non-existent session", async () => {
    assert.equal(await readSessionJsonl("no-jsonl", root), null);
  });
});

// #2554 / Codex round 1: the reload half of the model chip. If this stopped
// writing, the chip would simply vanish on reload and every other test stays
// green — the failure has no other symptom.
describe("updateResolvedModel", () => {
  it("round-trips the model through session meta", async () => {
    await createSessionMeta("rm-1", "general", "hi", root);
    await updateResolvedModel("rm-1", "claude-haiku-4-5-20251001", root);
    assert.equal((await readSessionMeta("rm-1", root))?.resolvedModel, "claude-haiku-4-5-20251001");
  });

  it("preserves the fields it is not writing", async () => {
    await createSessionMeta("rm-2", "guide", "first message", root);
    await setClaudeSessionId("rm-2", "cli-session-abc", root);
    await updateResolvedModel("rm-2", "claude-opus-5[1m]", root);
    const meta = await readSessionMeta("rm-2", root);
    assert.equal(meta?.resolvedModel, "claude-opus-5[1m]");
    assert.equal(meta?.roleId, "guide");
    assert.equal(meta?.claudeSessionId, "cli-session-abc");
    assert.equal(meta?.firstUserMessage, "first message");
  });

  // Rewritten every turn, so a session whose model changed mid-conversation
  // reports the latest rather than the first.
  it("overwrites an earlier model", async () => {
    await createSessionMeta("rm-3", "general", "hi", root);
    await updateResolvedModel("rm-3", "claude-sonnet-5", root);
    await updateResolvedModel("rm-3", "claude-haiku-4-5-20251001", root);
    assert.equal((await readSessionMeta("rm-3", root))?.resolvedModel, "claude-haiku-4-5-20251001");
  });

  it("does nothing when there is no session meta to update", async () => {
    await updateResolvedModel("rm-missing", "claude-opus-5", root);
    assert.equal(await readSessionMeta("rm-missing", root), null);
  });
});

// #3147. The override is the only model value in this file that reaches
// `claude --model`, so it is validated on the way in and — the part that is
// easy to get wrong — the key must LEAVE the file when cleared. A stored empty
// value would shadow the role and the app-wide setting forever.
describe("updateSessionChatModel", () => {
  it("round-trips an override", async () => {
    await createSessionMeta("sm-1", "general", "hi", root);
    await updateSessionChatModel("sm-1", "opus", root);
    assert.equal((await readSessionMeta("sm-1", root))?.chatModel, "opus");
  });

  it("REMOVES the key when cleared, rather than storing an empty value", async () => {
    await createSessionMeta("sm-2", "general", "hi", root);
    await updateSessionChatModel("sm-2", "opus", root);
    await updateSessionChatModel("sm-2", undefined, root);
    const meta = await readSessionMeta("sm-2", root);
    assert.equal(meta?.chatModel, undefined);
    assert.equal("chatModel" in (meta ?? {}), false, "the key itself must be gone so the cascade falls through");
  });

  it("preserves the fields it is not writing", async () => {
    await createSessionMeta("sm-3", "guide", "first", root);
    await setClaudeSessionId("sm-3", "cli-abc", root);
    await updateResolvedModel("sm-3", "claude-opus-5[1m]", root);
    await updateSessionChatModel("sm-3", "haiku", root);
    const meta = await readSessionMeta("sm-3", root);
    assert.equal(meta?.chatModel, "haiku");
    assert.equal(meta?.roleId, "guide");
    assert.equal(meta?.claudeSessionId, "cli-abc");
    assert.equal(meta?.resolvedModel, "claude-opus-5[1m]");
    assert.equal(meta?.firstUserMessage, "first");
  });

  // The CHOSEN value and the OBSERVED value are different fields on purpose;
  // writing one must not disturb the other.
  it("does not disturb resolvedModel, which is an observation, not a setting", async () => {
    await createSessionMeta("sm-4", "general", "hi", root);
    await updateResolvedModel("sm-4", "claude-haiku-4-5-20251001", root);
    await updateSessionChatModel("sm-4", "opus", root);
    await updateSessionChatModel("sm-4", undefined, root);
    assert.equal((await readSessionMeta("sm-4", root))?.resolvedModel, "claude-haiku-4-5-20251001");
  });

  it("does nothing when there is no session meta", async () => {
    await updateSessionChatModel("sm-missing", "opus", root);
    assert.equal(await readSessionMeta("sm-missing", root), null);
  });

  // A hand-edited file naming an unknown alias must not survive the read — the
  // value would otherwise reach `claude --model` and fail the spawn.
  it("rejects a stored alias that is not a known one", async () => {
    await createSessionMeta("sm-5", "general", "hi", root);
    // Written as raw JSON, not through `writeSessionMeta`: the typed writer
    // cannot express this, which is the point — only a hand edit can, and a
    // hand edit is exactly what the validator exists for.
    writeFileSync(path.join(root, WORKSPACE_DIRS.chat, "sm-5.json"), JSON.stringify({ roleId: "general", chatModel: "gpt-4o" }));
    assert.equal(await readSessionMeta("sm-5", root), null, "a bad alias must not be handed on to `claude --model`");
  });
});
