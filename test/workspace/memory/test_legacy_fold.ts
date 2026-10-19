import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FOLDED_LEGACY_TYPE, legacyFoldEntries } from "../../../server/workspace/memory/legacy-fold.js";
import { parseCandidates } from "../../../server/workspace/memory/migrate.js";
import { clusterAtomicIntoStaging } from "../../../server/workspace/memory/topic-migrate.js";
import { writeMemoryEntry } from "../../../server/workspace/memory/io.js";
import type { MemoryClusterer } from "../../../server/workspace/memory/topic-cluster.js";
import type { MemoryEntry } from "../../../server/workspace/memory/types.js";

const atomic = (body: string): MemoryEntry => ({ name: body, description: "d", type: "preference", body, slug: `preference_${body}` });

describe("legacyFoldEntries", () => {
  it("turns each legacy bullet into a fact entry for the cluster", () => {
    const folded = legacyFoldEntries(parseCandidates("# Memory\n\n## Travel\n- planning Egypt\n- owns a toaster oven\n"), []);
    assert.deepEqual(
      folded.map((entry) => [entry.type, entry.body, entry.description]),
      [
        [FOLDED_LEGACY_TYPE, "planning Egypt", "Travel"],
        [FOLDED_LEGACY_TYPE, "owns a toaster oven", "Travel"],
      ],
    );
  });

  it("skips bullets already present as an atomic entry, ignoring case and spacing", () => {
    const folded = legacyFoldEntries(parseCandidates("- Uses  YARN\n- likes tea\n"), [atomic("uses yarn")]);
    assert.deepEqual(
      folded.map((entry) => entry.body),
      ["likes tea"],
    );
  });

  it("drops repeated bullets within the legacy file", () => {
    assert.equal(legacyFoldEntries(parseCandidates("- likes tea\n- likes tea\n"), []).length, 1);
  });

  it("folds nothing from the old placeholder, prose, or an empty file", () => {
    assert.deepEqual(legacyFoldEntries(parseCandidates("# Memory\n\nDistilled facts about you and your work.\n"), []), []);
    assert.deepEqual(legacyFoldEntries(parseCandidates("just some prose\n"), []), []);
    assert.deepEqual(legacyFoldEntries(parseCandidates(""), []), []);
  });

  it("gives every folded entry a distinct slug", () => {
    const folded = legacyFoldEntries(parseCandidates("- a\n- b\n- c\n"), []);
    assert.equal(new Set(folded.map((entry) => entry.slug)).size, folded.length);
  });
});

describe("clusterAtomicIntoStaging — folds a leftover memory.md (#3460)", () => {
  it("sends the leftover bullets to the clusterer and counts them toward bulletsLost", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-legacy-fold-"));
    try {
      await writeMemoryEntry(root, atomic("yarn"));
      await mkdir(path.join(root, "conversations"), { recursive: true });
      await writeFile(path.join(root, "conversations", "memory.md"), "# Memory\n\n- keeps a sourdough starter\n");
      let clusteredBodies: string[] = [];
      const clusterer: MemoryClusterer = async (entries) => {
        clusteredBodies = entries.map((entry) => entry.body);
        return {
          preference: [{ topic: "dev", unsectionedBullets: ["yarn"] }],
          interest: [],
          fact: [{ topic: "kitchen", unsectionedBullets: ["keeps a sourdough starter"] }],
          reference: [],
        };
      };
      const result = await clusterAtomicIntoStaging(root, clusterer);
      assert.deepEqual(clusteredBodies.sort(), ["keeps a sourdough starter", "yarn"]);
      assert.equal(result.inputCount, 2);
      assert.equal(result.bulletsLost, 0);
      assert.match(await readFile(path.join(result.stagingPath, "fact", "kitchen.md"), "utf-8"), /keeps a sourdough starter/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
