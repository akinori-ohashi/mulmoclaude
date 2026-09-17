import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTAINER_CLAUDE_CONFIG_DIR,
  rewriteInstalledPlugins,
  rewriteKnownMarketplaces,
  toContainerConfigPath,
  toContainerPath,
} from "../../server/agent/pluginLedgerPaths.ts";

const POSIX_SEP = "/";
const WINDOWS_SEP = "\\";
const POSIX_CONFIG_DIR = "/Users/someone/.claude";
/** The mapping every sandbox has: the config dir alone. */
const CONFIG_MAPPING = [{ hostRoot: POSIX_CONFIG_DIR, containerRoot: CONTAINER_CLAUDE_CONFIG_DIR }];
const WINDOWS_CONFIG_DIR = "C:\\Users\\someone\\.claude";

describe("toContainerConfigPath", () => {
  it("rewrites a path under the config dir to its container spelling", () => {
    assert.equal(
      toContainerConfigPath(POSIX_CONFIG_DIR, `${POSIX_CONFIG_DIR}/plugins/cache/mp/plug/1.0.0`, POSIX_SEP),
      `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/cache/mp/plug/1.0.0`,
    );
  });

  it("maps the config dir itself", () => {
    assert.equal(toContainerConfigPath(POSIX_CONFIG_DIR, POSIX_CONFIG_DIR, POSIX_SEP), CONTAINER_CLAUDE_CONFIG_DIR);
  });

  it("tolerates a trailing separator on the config dir", () => {
    assert.equal(toContainerConfigPath(`${POSIX_CONFIG_DIR}/`, `${POSIX_CONFIG_DIR}/plugins/x`, POSIX_SEP), `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/x`);
  });

  // This function carries the config mapping ALONE, so a path outside it is
  // under none of the roots it knows and must survive as it is rather than be
  // rewritten into a path that exists but holds something else. Such a tree can
  // still be mounted and translated — that is `toContainerPath` with the mapping
  // for it (#3198), not this single-mapping case.
  it("refuses a path outside the config dir", () => {
    assert.equal(toContainerConfigPath(POSIX_CONFIG_DIR, "/Users/someone/dev/my-plugin", POSIX_SEP), null);
  });

  it("refuses a sibling directory that merely shares the prefix", () => {
    assert.equal(toContainerConfigPath(POSIX_CONFIG_DIR, "/Users/someone/.claude-backup/plugins/x", POSIX_SEP), null);
  });

  // The line #3184 drew: absolute and free of `.` / `..` segments.
  it("refuses traversal segments", () => {
    assert.equal(toContainerConfigPath(POSIX_CONFIG_DIR, `${POSIX_CONFIG_DIR}/plugins/../../../etc`, POSIX_SEP), null);
    assert.equal(toContainerConfigPath(POSIX_CONFIG_DIR, `${POSIX_CONFIG_DIR}/./plugins/x`, POSIX_SEP), null);
  });

  // The guard asks whether the VALUE escapes the config dir, not whether the
  // config dir is tidily spelled. Asking the whole string instead would make a
  // `CLAUDE_CONFIG_DIR` carrying a `.` segment reject every plugin under it —
  // silently, which is the exact failure shape this module exists to remove.
  it("translates under a config dir that itself carries a dot segment", () => {
    assert.equal(toContainerConfigPath("/Users/someone/./claude", "/Users/someone/./claude/plugins/x", POSIX_SEP), `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/x`);
  });

  it("refuses values that are not non-empty strings", () => {
    [undefined, null, 42, "", {}, []].forEach((value) => {
      assert.equal(toContainerConfigPath(POSIX_CONFIG_DIR, value, POSIX_SEP), null);
    });
  });

  // A backslash is an ordinary filename character on POSIX, so `we\\ird` is ONE
  // directory. Folding it to a separator would invent a level that is not there.
  it("keeps a backslash inside a POSIX filename as part of the segment", () => {
    assert.equal(toContainerConfigPath(POSIX_CONFIG_DIR, `${POSIX_CONFIG_DIR}/plugins/we\\ird`, POSIX_SEP), `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/we\\ird`);
  });

  it("does not mistake a dot inside a segment for a traversal segment", () => {
    assert.equal(toContainerConfigPath("/Users/some.one/.claude", "/Users/some.one/.claude/plugins/x", POSIX_SEP), `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/x`);
  });

  describe("windows spelling", () => {
    it("rewrites a backslash path and emits POSIX separators", () => {
      assert.equal(
        toContainerConfigPath(WINDOWS_CONFIG_DIR, `${WINDOWS_CONFIG_DIR}\\plugins\\cache\\mp\\plug`, WINDOWS_SEP),
        `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/cache/mp/plug`,
      );
    });

    // A Windows filesystem is case-insensitive, so these name one directory.
    it("compares case-insensitively", () => {
      assert.equal(
        toContainerConfigPath(WINDOWS_CONFIG_DIR, "c:\\users\\someone\\.claude\\plugins\\x", WINDOWS_SEP),
        `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/x`,
      );
    });

    // The CLI writes backslashes, but a `CLAUDE_CONFIG_DIR` override can arrive
    // with forward slashes. On Windows those name one directory, so a mismatch
    // here would silently leave every plugin untranslated.
    it("matches across mixed separators", () => {
      assert.equal(
        toContainerConfigPath("C:/Users/someone/.claude", `${WINDOWS_CONFIG_DIR}\\plugins\\x`, WINDOWS_SEP),
        `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/x`,
      );
      assert.equal(toContainerConfigPath(WINDOWS_CONFIG_DIR, "C:/Users/someone/.claude/plugins/x", WINDOWS_SEP), `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/x`);
    });

    // Case folding is not length-preserving: `\u0130`.toLowerCase() is two code
    // units. Matching by a folded prefix's LENGTH ate the first character of the
    // relative path, turning `plugins` into `lugins`.
    it("survives a character whose lowercase form is longer", () => {
      const dir = `C:\\Users\\\u0130\\.claude`;
      assert.equal(toContainerConfigPath(dir, `${dir}\\plugins\\x`, WINDOWS_SEP), `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/x`);
    });

    it("keeps POSIX comparison case-SENSITIVE", () => {
      assert.equal(toContainerConfigPath(POSIX_CONFIG_DIR, "/users/someone/.claude/plugins/x", POSIX_SEP), null);
    });
  });
});

describe("rewriteKnownMarketplaces", () => {
  const ledger = {
    "in-config": {
      source: { source: "github", repo: "a/b" },
      installLocation: `${POSIX_CONFIG_DIR}/plugins/marketplaces/in-config`,
      lastUpdated: "x",
    },
    // A marketplace whose tree is under none of the mappings given here, so no
    // spelling reaches it — it must survive verbatim rather than be dropped,
    // which would uninstall it. With a mapping for that tree it translates; the
    // fixture withholds one deliberately, to pin the leave-it-alone path.
    external: { source: { source: "local", path: "/elsewhere/mp" }, installLocation: "/elsewhere/mp" },
  };

  it("rewrites installLocation under the config dir and leaves everything else alone", () => {
    assert.deepEqual(rewriteKnownMarketplaces(ledger, CONFIG_MAPPING, POSIX_SEP), {
      "in-config": {
        source: { source: "github", repo: "a/b" },
        installLocation: `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/marketplaces/in-config`,
        lastUpdated: "x",
      },
      external: { source: { source: "local", path: "/elsewhere/mp" }, installLocation: "/elsewhere/mp" },
    });
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(ledger);
    rewriteKnownMarketplaces(ledger, CONFIG_MAPPING, POSIX_SEP);
    assert.equal(JSON.stringify(ledger), before);
  });

  it("returns malformed shapes untouched", () => {
    assert.equal(rewriteKnownMarketplaces(null, CONFIG_MAPPING, POSIX_SEP), null);
    assert.equal(rewriteKnownMarketplaces("nope", CONFIG_MAPPING, POSIX_SEP), "nope");
    assert.deepEqual(rewriteKnownMarketplaces({ mp: 7 }, CONFIG_MAPPING, POSIX_SEP), { mp: 7 });
    assert.deepEqual(rewriteKnownMarketplaces({ mp: {} }, CONFIG_MAPPING, POSIX_SEP), { mp: {} });
  });
});

describe("rewriteInstalledPlugins", () => {
  const ledger = {
    version: 2,
    plugins: {
      "plug@mp": [{ scope: "user", installPath: `${POSIX_CONFIG_DIR}/plugins/cache/mp/plug/1.0.0`, version: "1.0.0" }],
      "external@mp": [{ scope: "user", installPath: "/elsewhere/mp/plugins/external" }],
    },
  };

  it("rewrites installPath, keeps siblings, and keeps an out-of-config install verbatim", () => {
    assert.deepEqual(rewriteInstalledPlugins(ledger, CONFIG_MAPPING, POSIX_SEP), {
      version: 2,
      plugins: {
        "plug@mp": [{ scope: "user", installPath: `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/cache/mp/plug/1.0.0`, version: "1.0.0" }],
        "external@mp": [{ scope: "user", installPath: "/elsewhere/mp/plugins/external" }],
      },
    });
  });

  it("rewrites every install of a plugin recorded at more than one scope", () => {
    const multi = {
      plugins: {
        "plug@mp": [
          { scope: "user", installPath: `${POSIX_CONFIG_DIR}/plugins/cache/a` },
          { scope: "project", installPath: `${POSIX_CONFIG_DIR}/plugins/cache/b` },
        ],
      },
    };
    assert.deepEqual(rewriteInstalledPlugins(multi, CONFIG_MAPPING, POSIX_SEP), {
      plugins: {
        "plug@mp": [
          { scope: "user", installPath: `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/cache/a` },
          { scope: "project", installPath: `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/cache/b` },
        ],
      },
    });
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(ledger);
    rewriteInstalledPlugins(ledger, CONFIG_MAPPING, POSIX_SEP);
    assert.equal(JSON.stringify(ledger), before);
  });

  it("returns malformed shapes untouched", () => {
    assert.equal(rewriteInstalledPlugins(null, CONFIG_MAPPING, POSIX_SEP), null);
    assert.deepEqual(rewriteInstalledPlugins({ version: 2 }, CONFIG_MAPPING, POSIX_SEP), { version: 2 });
    assert.deepEqual(rewriteInstalledPlugins({ plugins: { "a@b": "nope" } }, CONFIG_MAPPING, POSIX_SEP), { plugins: { "a@b": "nope" } });
    assert.deepEqual(rewriteInstalledPlugins({ plugins: { "a@b": [7] } }, CONFIG_MAPPING, POSIX_SEP), { plugins: { "a@b": [7] } });
  });
});

// A sandbox carries the config dir plus, since #3198, one mount per plugin tree
// registered from a local path outside it. The translation has to serve all of
// them, and must not depend on the caller ordering the list correctly.
describe("toContainerPath — several mounted roots", () => {
  const EXTERNAL = "/Users/someone/dev/my-marketplace";
  const MAPPINGS = [
    { hostRoot: POSIX_CONFIG_DIR, containerRoot: CONTAINER_CLAUDE_CONFIG_DIR },
    { hostRoot: EXTERNAL, containerRoot: "/mnt/plugin-src/my-marketplace-abcd1234" },
  ];

  it("translates against whichever root the value is under", () => {
    assert.equal(toContainerPath(MAPPINGS, `${POSIX_CONFIG_DIR}/plugins/cache/x`, POSIX_SEP), `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/cache/x`);
    assert.equal(toContainerPath(MAPPINGS, `${EXTERNAL}/plugins/p`, POSIX_SEP), "/mnt/plugin-src/my-marketplace-abcd1234/plugins/p");
  });

  it("maps a root itself to its container root", () => {
    assert.equal(toContainerPath(MAPPINGS, EXTERNAL, POSIX_SEP), "/mnt/plugin-src/my-marketplace-abcd1234");
  });

  it("returns null for a value under none of them", () => {
    assert.equal(toContainerPath(MAPPINGS, "/Users/someone/unrelated", POSIX_SEP), null);
  });

  // The LONGEST match wins, so a nested mapping is not shadowed by its parent
  // whatever order the caller passes them in — a contract obeyed until it isn't.
  it("prefers the most specific root regardless of order", () => {
    const parent = { hostRoot: "/srv/trees", containerRoot: "/mnt/parent" };
    const child = { hostRoot: "/srv/trees/one", containerRoot: "/mnt/child" };
    const value = "/srv/trees/one/plugins/p";
    assert.equal(toContainerPath([parent, child], value, POSIX_SEP), "/mnt/child/plugins/p");
    assert.equal(toContainerPath([child, parent], value, POSIX_SEP), "/mnt/child/plugins/p");
  });

  it("ignores a mapping with an empty root", () => {
    assert.equal(toContainerPath([{ hostRoot: "", containerRoot: "/mnt/x" }], "/anything", POSIX_SEP), null);
  });

  // Same rule as the single-root case: the part BELOW the matched root is what
  // could escape, and a corrupt ledger is left alone rather than rewritten.
  it("refuses a traversal segment below the matched root", () => {
    assert.equal(toContainerPath(MAPPINGS, `${EXTERNAL}/plugins/../../etc`, POSIX_SEP), null);
  });
});
