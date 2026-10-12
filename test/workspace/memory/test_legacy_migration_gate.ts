import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decideLegacyMigration, LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES, type LegacyMemoryState } from "../../../server/workspace/memory/legacy-migration-gate.js";

const REAL_SIZE = LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES * 10;

function state(overrides: Partial<LegacyMemoryState>): LegacyMemoryState {
  return { legacySizeBytes: REAL_SIZE, backupExists: false, topicFormat: false, ...overrides };
}

function verdict(overrides: Partial<LegacyMemoryState>): string {
  const gate = decideLegacyMigration(state(overrides));
  return gate.run ? "run" : gate.reason;
}

describe("decideLegacyMigration", () => {
  it("runs for a real legacy file with no backup in an atomic workspace", () => {
    assert.equal(verdict({}), "run");
  });

  it("skips when memory.md is absent", () => {
    assert.equal(verdict({ legacySizeBytes: null }), "no-legacy-file");
    assert.equal(verdict({ legacySizeBytes: null, topicFormat: true, backupExists: true }), "no-legacy-file");
  });

  it("skips in a topic-format workspace however large memory.md is and with no backup", () => {
    assert.equal(verdict({ topicFormat: true }), "topic-format");
    assert.equal(verdict({ topicFormat: true, legacySizeBytes: Number.MAX_SAFE_INTEGER }), "topic-format");
    assert.equal(verdict({ topicFormat: true, backupExists: true }), "topic-format");
    assert.equal(verdict({ topicFormat: true, legacySizeBytes: 0 }), "topic-format");
  });

  it("skips a placeholder-sized file, with the threshold itself counting as real", () => {
    assert.equal(verdict({ legacySizeBytes: 0 }), "placeholder");
    assert.equal(verdict({ legacySizeBytes: LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES - 1 }), "placeholder");
    assert.equal(verdict({ legacySizeBytes: LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES }), "run");
  });

  it("skips when .backup marks a completed migration", () => {
    assert.equal(verdict({ backupExists: true }), "already-migrated");
  });

  it("reports placeholder before already-migrated when both hold", () => {
    assert.equal(verdict({ legacySizeBytes: 1, backupExists: true }), "placeholder");
  });

  it("never runs whenever the workspace is topic format", () => {
    const sizes = [null, 0, LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES - 1, LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES, REAL_SIZE];
    sizes.forEach((legacySizeBytes) =>
      [true, false].forEach((backupExists) => {
        assert.equal(decideLegacyMigration({ legacySizeBytes, backupExists, topicFormat: true }).run, false);
      }),
    );
  });
});
