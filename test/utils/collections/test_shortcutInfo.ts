// Unit tests for the index-row → shortcut-info mapper
// (packages/core/src/collection/core/shortcutInfo.ts).
//
// The one subtle rule is that `color` must be ABSENT rather than `undefined`
// when a row has none: the shortcut shapes declare it narrow because the
// remote-host handlers pass them through `Jsonify`, and `JSON.stringify`
// writes an explicit undefined member as `null`. Both index views used to
// spell this out inline, which is what this mapper exists to stop.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toShortcutInfo } from "@mulmoclaude/core/collection";

describe("toShortcutInfo", () => {
  it("carries slug, title, icon and colour straight through", () => {
    assert.deepEqual(toShortcutInfo({ slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" }, "dataset"), {
      slug: "podcasts",
      title: "Podcasts",
      icon: "podcasts",
      color: "violet",
    });
  });

  it("omits the colour key entirely when the row has none", () => {
    const info = toShortcutInfo({ slug: "notes", title: "Notes", icon: "menu_book" }, "dataset");
    assert.equal("color" in info, false);
    assert.equal(JSON.stringify(info).includes("color"), false);
  });

  it("never emits a null colour", () => {
    // The failure this guards: `{ color: undefined }` serialises as
    // `"color": null`, which is neither absent nor a valid colour.
    [undefined].forEach((color) => {
      assert.equal(JSON.stringify(toShortcutInfo({ slug: "s", title: "T", icon: "i", color }, "dataset")).includes("null"), false);
    });
  });

  it("falls back when the row's icon is missing or empty", () => {
    [undefined, ""].forEach((icon) => {
      assert.equal(toShortcutInfo({ slug: "news", title: "News", icon }, "dynamic_feed").icon, "dynamic_feed", JSON.stringify(icon));
    });
  });

  it("prefers the row's own icon over the fallback", () => {
    assert.equal(toShortcutInfo({ slug: "news", title: "News", icon: "rss_feed" }, "dynamic_feed").icon, "rss_feed");
  });

  it("passes an emoji icon through untouched", () => {
    // #2986 made emoji a supported icon; the mapper must not treat one as
    // absent just because it is not a Material Symbols name.
    assert.equal(toShortcutInfo({ slug: "mic", title: "Mic", icon: "🎙️" }, "dataset").icon, "🎙️");
  });
});
