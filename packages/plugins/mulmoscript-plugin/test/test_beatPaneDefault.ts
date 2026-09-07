import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Which pane the View opens on.
 *
 * Opening the script is what renders each beat's image: the auto-render on mount lives in the
 * per-beat media list, so opening on the editor instead silently stops thumbnails from being
 * produced at all. Two e2e tests caught that — this asserts it far earlier, and states why the
 * default is what it is rather than leaving it to look arbitrary.
 *
 * Read from source rather than mounted: the value is a literal in `<script setup>`, and mounting
 * the whole View here would need a runtime, a transport and a host adapter to assert one word.
 */

const viewSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "vue", "View.vue"), "utf-8");

describe("the beats pane the View opens on", () => {
  it("is the media list, because auto-render on mount lives there", () => {
    const declaration = /const beatPane = ref<"edit" \| "media">\("(\w+)"\)/.exec(viewSource);
    assert.ok(declaration, "beatPane is declared with an explicit initial pane");
    assert.equal(declaration[1], "media");
  });

  it("still offers the editor — the list is not the only pane", () => {
    assert.match(viewSource, /data-testid="mulmo-script-tab-edit"/);
    assert.match(viewSource, /data-testid="mulmo-script-tab-media"/);
  });
});
