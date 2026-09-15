import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  couldBeClaudePluginSkill,
  disabledPluginKeys,
  parsePluginLedger,
  pluginNameFromLedgerKey,
  pluginSkillRoots,
  readClaudePluginSkillRoots,
} from "../../server/workspace/skills/claude-plugins.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "claude-plugins-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("pluginNameFromLedgerKey", () => {
  it("drops the marketplace half", () => {
    assert.equal(pluginNameFromLedgerKey("ever-better@ever-better"), "ever-better");
    assert.equal(pluginNameFromLedgerKey("mulmocast@mulmocast-plugins"), "mulmocast");
  });

  it("keeps a scoped plugin name whole — the marketplace separator is the LAST @", () => {
    assert.equal(pluginNameFromLedgerKey("@acme/tools@acme-marketplace"), "@acme/tools");
  });

  it("returns the key unchanged when there is no marketplace half", () => {
    assert.equal(pluginNameFromLedgerKey("solo"), "solo");
  });

  it("keeps a leading-@ key whole — it is indistinguishable from a scoped name with no marketplace", () => {
    assert.equal(pluginNameFromLedgerKey("@acme/tools"), "@acme/tools");
    assert.equal(pluginNameFromLedgerKey("@shop"), "@shop");
  });

  it("returns an empty name for an empty key", () => {
    assert.equal(pluginNameFromLedgerKey(""), "");
  });
});

describe("couldBeClaudePluginSkill", () => {
  it("is true only for a namespaced name", () => {
    assert.equal(couldBeClaudePluginSkill("mulmocast:story"), true);
    assert.equal(couldBeClaudePluginSkill("demo:mc-foo"), true);
    assert.equal(couldBeClaudePluginSkill("release-app"), false);
    assert.equal(couldBeClaudePluginSkill("mc-manage-skills"), false);
    assert.equal(couldBeClaudePluginSkill(""), false);
  });
});

describe("parsePluginLedger", () => {
  const ledger = {
    version: 2,
    plugins: {
      "demo@shop": [{ scope: "user", installPath: "/plugins/demo/1.0.0", version: "1.0.0" }],
      "other@shop": [{ scope: "user", installPath: "/plugins/other/2.0.0" }],
    },
  };

  it("reads every install in ledger order", () => {
    assert.deepEqual(parsePluginLedger(ledger), [
      { key: "demo@shop", pluginName: "demo", installPath: "/plugins/demo/1.0.0" },
      { key: "other@shop", pluginName: "other", installPath: "/plugins/other/2.0.0" },
    ]);
  });

  it("keeps both installs when one plugin is recorded at two scopes", () => {
    const twoScopes = { plugins: { "demo@shop": [{ installPath: "/a" }, { installPath: "/b" }] } };
    assert.deepEqual(
      parsePluginLedger(twoScopes).map((install) => install.installPath),
      ["/a", "/b"],
    );
  });

  it("returns an empty list for anything that is not a ledger", () => {
    [null, undefined, 42, "text", [], {}, { plugins: null }, { plugins: [] }, { plugins: "x" }].forEach((value) => {
      assert.deepEqual(parsePluginLedger(value), [], `unexpected installs for ${JSON.stringify(value)}`);
    });
  });

  it("skips a relative install path — it would be followed from the server's cwd, not from anywhere the CLI wrote", () => {
    const relative = { plugins: { "demo@shop": [{ installPath: "plugins/demo" }, { installPath: "./demo" }] } };
    assert.deepEqual(parsePluginLedger(relative), []);
  });

  it("skips an install path with a traversal segment", () => {
    // Literal strings, the way a corrupt ledger carries them — `path.join` would
    // normalise the traversal away before the guard ever saw it.
    const traversal = {
      plugins: {
        "demo@shop": [{ installPath: "/plugins/../../etc" }, { installPath: "/plugins/./demo" }, { installPath: "/plugins/demo/.." }],
        "kept@shop": [{ installPath: "/plugins/kept" }],
      },
    };
    assert.deepEqual(
      parsePluginLedger(traversal).map((install) => install.installPath),
      ["/plugins/kept"],
    );
  });

  it("skips entries with no usable installPath", () => {
    const broken = {
      plugins: {
        "a@shop": [{ installPath: "" }, { installPath: 7 }, { scope: "user" }, "not-an-object", null],
        "b@shop": "not-an-array",
        "": [{ installPath: "/nameless" }],
        "c@shop": [{ installPath: "/kept" }],
      },
    };
    assert.deepEqual(parsePluginLedger(broken), [{ key: "c@shop", pluginName: "c", installPath: "/kept" }]);
  });
});

describe("disabledPluginKeys", () => {
  it("collects only the keys explicitly set to false", () => {
    const disabled = disabledPluginKeys([{ enabledPlugins: { "on@shop": true, "off@shop": false } }]);
    assert.deepEqual([...disabled], ["off@shop"]);
  });

  it("lets a later settings file flip an earlier one in both directions", () => {
    const userSettings = { enabledPlugins: { "a@shop": false, "b@shop": true } };
    const workspaceSettings = { enabledPlugins: { "a@shop": true, "b@shop": false } };
    assert.deepEqual([...disabledPluginKeys([userSettings, workspaceSettings])], ["b@shop"]);
  });

  it("ignores non-boolean values and malformed settings", () => {
    const disabled = disabledPluginKeys([null, 42, "text", [], { enabledPlugins: null }, { enabledPlugins: { "a@shop": "false", "b@shop": 0 } }]);
    assert.deepEqual([...disabled], []);
  });
});

describe("pluginSkillRoots", () => {
  const installs = [
    { key: "demo@shop", pluginName: "demo", installPath: join("/plugins", "demo") },
    { key: "off@shop", pluginName: "off", installPath: join("/plugins", "off") },
  ];

  it("appends skills/ to each enabled install path", () => {
    assert.deepEqual(pluginSkillRoots(installs, new Set()), [
      { pluginName: "demo", skillsDir: join("/plugins", "demo", "skills") },
      { pluginName: "off", skillsDir: join("/plugins", "off", "skills") },
    ]);
  });

  it("drops a disabled plugin", () => {
    assert.deepEqual(
      pluginSkillRoots(installs, new Set(["off@shop"])).map((skillRoot) => skillRoot.pluginName),
      ["demo"],
    );
  });

  it("yields one root per plugin when the same plugin is installed twice", () => {
    const twice = [
      { key: "demo@shop", pluginName: "demo", installPath: "/first" },
      { key: "demo@shop", pluginName: "demo", installPath: "/second" },
    ];
    assert.deepEqual(pluginSkillRoots(twice, new Set()), [{ pluginName: "demo", skillsDir: join("/first", "skills") }]);
  });
});

describe("readClaudePluginSkillRoots", () => {
  async function writeLedger(contents: string): Promise<string> {
    const path = join(root, "installed_plugins.json");
    await writeFile(path, contents);
    return path;
  }

  it("returns an empty list when the ledger is absent", async () => {
    const roots = await readClaudePluginSkillRoots({ ledgerPath: join(root, "absent.json"), settingsPaths: [] });
    assert.deepEqual(roots, []);
  });

  it("returns an empty list when the ledger is not valid JSON", async () => {
    const ledgerPath = await writeLedger("{ not json");
    const roots = await readClaudePluginSkillRoots({ ledgerPath, settingsPaths: [] });
    assert.deepEqual(roots, []);
  });

  it("reads the installs and honours enabledPlugins from the settings files", async () => {
    const ledgerPath = await writeLedger(
      JSON.stringify({
        version: 2,
        plugins: {
          "demo@shop": [{ installPath: join(root, "demo") }],
          "hidden@shop": [{ installPath: join(root, "hidden") }],
        },
      }),
    );
    const userSettings = join(root, "settings.json");
    await writeFile(userSettings, JSON.stringify({ enabledPlugins: { "demo@shop": true, "hidden@shop": false } }));

    const roots = await readClaudePluginSkillRoots({ ledgerPath, settingsPaths: [userSettings, join(root, "absent-settings.json")] });
    assert.deepEqual(roots, [{ pluginName: "demo", skillsDir: join(root, "demo", "skills") }]);
  });

  it("includes a plugin the settings never mention", async () => {
    await mkdir(join(root, "demo", "skills"), { recursive: true });
    const ledgerPath = await writeLedger(JSON.stringify({ plugins: { "demo@shop": [{ installPath: join(root, "demo") }] } }));
    const roots = await readClaudePluginSkillRoots({ ledgerPath, settingsPaths: [join(root, "settings.json")] });
    assert.deepEqual(
      roots.map((skillRoot) => skillRoot.pluginName),
      ["demo"],
    );
  });
});
