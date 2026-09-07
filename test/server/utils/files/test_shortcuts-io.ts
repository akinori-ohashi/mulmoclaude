import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { WORKSPACE_FILES } from "../../../../server/workspace/paths.js";
import { normalizeShortcuts, readShortcuts, writeShortcuts } from "../../../../server/utils/files/shortcuts-io.js";
import type { Shortcut } from "../../../../src/types/shortcuts.js";
import { ACCENT_COLORS } from "@mulmoclaude/core/collection";

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmoclaude-shortcuts-"));
  return realpathSync(dir);
}

function rmDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function filePath(root: string): string {
  return path.join(root, WORKSPACE_FILES.shortcuts);
}

const sample: Shortcut = { kind: "collection", slug: "invoices", title: "Invoices", icon: "receipt" };

describe("shortcuts-io — read", () => {
  let root: string;
  before(() => {
    root = makeWorkspace();
  });
  after(() => rmDir(root));

  it("returns [] when the file is missing", async () => {
    assert.deepEqual(await readShortcuts(root), []);
  });

  it("returns [] on malformed JSON", async () => {
    mkdirSync(path.dirname(filePath(root)), { recursive: true });
    writeFileSync(filePath(root), "{ not json");
    assert.deepEqual(await readShortcuts(root), []);
  });

  it("reads back what was written", async () => {
    await writeShortcuts([sample], root);
    assert.deepEqual(await readShortcuts(root), [sample]);
  });
});

describe("shortcuts-io — write", () => {
  let root: string;
  before(() => {
    root = makeWorkspace();
  });
  after(() => rmDir(root));

  it("persists the object-wrapped shape with a trailing newline", async () => {
    await writeShortcuts([sample], root);
    const raw = readFileSync(filePath(root), "utf-8");
    assert.equal(raw.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(raw), { shortcuts: [sample] });
  });

  it("dedupes on (kind, slug), keeping the first occurrence", async () => {
    const written = await writeShortcuts(
      [sample, { kind: "collection", slug: "invoices", title: "Other label", icon: "x" }, { kind: "feed", slug: "invoices", title: "Feed", icon: "rss_feed" }],
      root,
    );
    assert.deepEqual(written, [sample, { kind: "feed", slug: "invoices", title: "Feed", icon: "rss_feed" }]);
  });
});

describe("normalizeShortcuts — accent colour (#2987)", () => {
  // `normalizeShortcuts` REBUILDS each entry, so any field it does not name is
  // dropped on every write — and every pin / unpin / reorder / reconcile goes
  // through it. Without these, the accent survived in memory and vanished the
  // moment it was persisted, which is exactly how it shipped broken.
  it("preserves a palette colour through a write/read round trip", async () => {
    const root = makeWorkspace();
    try {
      await writeShortcuts([{ kind: "collection", slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" }], root);
      assert.deepEqual(await readShortcuts(root), [{ kind: "collection", slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps every colour the palette declares", () => {
    ACCENT_COLORS.forEach((color) => {
      const [entry] = normalizeShortcuts([{ kind: "collection", slug: "s", title: "T", icon: "podcasts", color }]);
      assert.equal(entry?.color, color, color);
    });
  });

  it("drops a colour the palette does not carry rather than persisting it", () => {
    ["puce", "Violet", "", "red", 7, null, {}].forEach((color) => {
      const [entry] = normalizeShortcuts([{ kind: "collection", slug: "s", title: "T", icon: "podcasts", color }]);
      assert.ok(entry, JSON.stringify(color));
      assert.equal("color" in entry, false, JSON.stringify(color));
    });
  });

  it("omits the key entirely when there is no colour, rather than writing a null", () => {
    const [entry] = normalizeShortcuts([{ kind: "collection", slug: "s", title: "T", icon: "podcasts" }]);
    assert.ok(entry);
    assert.equal("color" in entry, false);
    assert.equal(JSON.stringify(entry).includes("color"), false);
  });
});

describe("normalizeShortcuts — validation", () => {
  it("drops non-array input", () => {
    assert.deepEqual(normalizeShortcuts(null), []);
    assert.deepEqual(normalizeShortcuts({ foo: 1 }), []);
  });

  it("drops entries with a bad kind or empty slug", () => {
    const input = [
      { kind: "wiki", slug: "x", title: "t", icon: "i" }, // bad kind
      { kind: "collection", slug: "", title: "t", icon: "i" }, // empty slug
      { kind: "feed", slug: "ok", title: "t", icon: "i" }, // valid
    ];
    assert.deepEqual(normalizeShortcuts(input), [{ kind: "feed", slug: "ok", title: "t", icon: "i" }]);
  });

  it("backfills missing title/icon defaults", () => {
    assert.deepEqual(normalizeShortcuts([{ kind: "collection", slug: "s" }]), [{ kind: "collection", slug: "s", title: "s", icon: "bookmark" }]);
  });
});
