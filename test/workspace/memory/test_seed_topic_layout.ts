import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LEGACY_MEMORY_PLACEHOLDER, shouldSeedTopicLayout, type MemoryLayoutState } from "../../../server/workspace/memory/seed-topic-layout.js";
import { seedTopicLayoutIfFresh } from "../../../server/workspace/memory/seed-topic-layout-run.js";
import { hasTopicFormat } from "../../../server/workspace/memory/topic-detect.js";

const FRESH: MemoryLayoutState = { memoryDirEntries: [], legacyMemoryText: null, stagingExists: false, unreadable: false };
const seed = (overrides: Partial<MemoryLayoutState>): boolean => shouldSeedTopicLayout({ ...FRESH, ...overrides });

describe("shouldSeedTopicLayout", () => {
  it("seeds a workspace with no memory at all", () => {
    assert.equal(seed({}), true);
  });

  it("seeds when the memory dir holds only the atomic index or Finder metadata", () => {
    assert.equal(seed({ memoryDirEntries: ["MEMORY.md"] }), true);
    assert.equal(seed({ memoryDirEntries: [".DS_Store", "MEMORY.md"] }), true);
  });

  it("does not seed over an .atomic-backup dir or any other dot-entry", () => {
    assert.equal(seed({ memoryDirEntries: [".atomic-backup-20261011-2041"] }), false);
    assert.equal(seed({ memoryDirEntries: [".hidden"] }), false);
  });

  it("does not seed when part of the state could not be read", () => {
    assert.equal(seed({ unreadable: true }), false);
  });

  it("recognises the placeholder saved with CRLF line endings or a BOM", () => {
    assert.equal(seed({ legacyMemoryText: LEGACY_MEMORY_PLACEHOLDER.replace(/\n/g, "\r\n") }), true);
    assert.equal(seed({ legacyMemoryText: `\uFEFF${LEGACY_MEMORY_PLACEHOLDER}` }), true);
  });

  it("seeds over the exact pre-#1029 placeholder memory.md", () => {
    assert.equal(seed({ legacyMemoryText: LEGACY_MEMORY_PLACEHOLDER }), true);
  });

  it("does not seed when memory.md holds anything beyond the placeholder", () => {
    assert.equal(seed({ legacyMemoryText: `${LEGACY_MEMORY_PLACEHOLDER}\n- likes yarn\n` }), false);
    assert.equal(seed({ legacyMemoryText: "- one fact\n" }), false);
    assert.equal(seed({ legacyMemoryText: "" }), false);
  });

  it("does not seed over an atomic entry, an existing type dir, or anything else in memory/", () => {
    assert.equal(seed({ memoryDirEntries: ["MEMORY.md", "preference_yarn.md"] }), false);
    assert.equal(seed({ memoryDirEntries: ["preference"] }), false);
    assert.equal(seed({ memoryDirEntries: ["notes.txt"] }), false);
  });

  it("does not seed while a topic migration is staged", () => {
    assert.equal(seed({ stagingExists: true }), false);
  });
});

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-seed-topic-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("seedTopicLayoutIfFresh", () => {
  it("turns a fresh workspace into topic format", async () => {
    await withWorkspace(async (root) => {
      assert.equal(seedTopicLayoutIfFresh(root), true);
      assert.equal(hasTopicFormat(root), true);
      assert.deepEqual((await readdir(path.join(root, "conversations", "memory"))).sort(), ["fact", "interest", "preference", "reference"]);
    });
  });

  it("leaves an atomic workspace with entries alone", async () => {
    await withWorkspace(async (root) => {
      const memoryDir = path.join(root, "conversations", "memory");
      await mkdir(memoryDir, { recursive: true });
      await writeFile(path.join(memoryDir, "preference_yarn.md"), "---\nname: yarn\ndescription: x\ntype: preference\n---\n\nyarn\n");
      assert.equal(seedTopicLayoutIfFresh(root), false);
      assert.equal(hasTopicFormat(root), false);
    });
  });

  it("leaves a workspace with a real legacy memory.md for the migration chain", async () => {
    await withWorkspace(async (root) => {
      await mkdir(path.join(root, "conversations"), { recursive: true });
      await writeFile(path.join(root, "conversations", "memory.md"), "# Memory\n\n- likes yarn\n");
      assert.equal(seedTopicLayoutIfFresh(root), false);
      assert.equal(hasTopicFormat(root), false);
    });
  });

  it("is a no-op on a workspace that is already topic format", async () => {
    await withWorkspace(async (root) => {
      seedTopicLayoutIfFresh(root);
      assert.equal(seedTopicLayoutIfFresh(root), false);
    });
  });

  it("treats a dangling memory.next symlink as staging, not as absent", async () => {
    await withWorkspace(async (root) => {
      await mkdir(path.join(root, "conversations"), { recursive: true });
      await symlink(path.join(root, "nowhere"), path.join(root, "conversations", "memory.next"));
      assert.equal(seedTopicLayoutIfFresh(root), false);
    });
  });
});
