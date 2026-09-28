// A user-scope collection is read-only and lives outside the workspace, so the
// workspace's staging tree is never its authoring copy — even when a
// `data/skills/<slug>/` of the same name happens to exist. getSchema has to
// answer with the collection's own schema, not the unrelated staging file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { configureCollectionHost, makeManageCollectionTool } from "../../src/collection/server/index.ts";
import { makeTempDir } from "../helpers/tempDir.js";

const noopLog = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function writeSchema(dir: string, title: string): void {
  mkdirSync(dir, { recursive: true });
  const fields = { id: { type: "string", label: "Id", primary: true } };
  writeFileSync(path.join(dir, "schema.json"), JSON.stringify({ title, icon: "list", primaryKey: "id", dataPath: "data/journal", fields }));
}

const userSkillsRoot = makeTempDir("gsu-user-");
const workspaceRoot = makeTempDir("gsu-workspace-");
writeSchema(path.join(userSkillsRoot, "journal"), "User journal");
writeSchema(path.join(workspaceRoot, "data", "skills", "journal"), "Stray staging");

configureCollectionHost({
  workspaceRoot: null,
  log: noopLog,
  paths: {
    userSkillsDir: () => userSkillsRoot,
    projectSkillsDir: (root) => path.join(root, ".claude", "skills"),
    feedsRoot: (root) => path.join(root, "data", "feeds"),
    skillsStagingDir: (root) => path.join(root, "data", "skills"),
    archiveDir: "data/archive",
    collectionsRegistriesConfig: (root) => path.join(root, "config", "collections-registries.json"),
  },
  isPresetSlug: () => false,
});

test("getSchema on a user-scope collection returns its own schema, never a same-slug workspace staging file", async () => {
  const reply = await makeManageCollectionTool({ workspaceRoot }).handler({ action: "getSchema", slug: "journal" });
  assert.doesNotMatch(reply, /manageCollection: NOTE/);
  assert.equal(JSON.parse(reply).title, "User journal");
});
