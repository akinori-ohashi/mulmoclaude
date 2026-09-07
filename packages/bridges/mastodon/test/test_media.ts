import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fitBudget, hasRelayableContent, imageMediaEntries, isLostImagesOnly, resolveMessageText, MAX_TOTAL_BASE64_CHARS } from "../src/media.ts";

describe("imageMediaEntries", () => {
  it("keeps the image entries in order", () => {
    const media = [
      { type: "image", url: "https://a.example/1.png" },
      { type: "image", url: "https://a.example/2.png" },
    ];
    assert.deepEqual(imageMediaEntries(media), [{ url: "https://a.example/1.png" }, { url: "https://a.example/2.png" }]);
  });

  it("skips the media types the bridge does not forward", () => {
    const media = [
      { type: "video", url: "https://a.example/clip.mp4" },
      { type: "image", url: "https://a.example/1.png" },
      { type: "gifv", url: "https://a.example/loop.mp4" },
      { type: "audio", url: "https://a.example/a.ogg" },
      { type: "unknown", url: "https://a.example/x" },
    ];
    assert.deepEqual(imageMediaEntries(media), [{ url: "https://a.example/1.png" }]);
  });

  it("skips entries with no usable url", () => {
    const media = [{ type: "image" }, { type: "image", url: 42 }, { type: "image", url: null }, "not an object", null];
    assert.deepEqual(imageMediaEntries(media), []);
  });

  it("returns an empty list when the status carries no media field", () => {
    assert.deepEqual(imageMediaEntries(undefined), []);
    assert.deepEqual(imageMediaEntries(null), []);
    assert.deepEqual(imageMediaEntries({}), []);
    assert.deepEqual(imageMediaEntries([]), []);
  });
});

describe("resolveMessageText", () => {
  it("keeps the sender's caption when nothing was lost", () => {
    assert.equal(resolveMessageText("  what is this?  ", 0), "what is this?");
  });

  it("substitutes a prompt for an image-only DM — chat-service rejects an empty text", () => {
    assert.equal(resolveMessageText("", 0), "Describe / analyze this file.");
    // `stripLeadingMentions` trims, but a caption of pure whitespace
    // would still reach here.
    assert.equal(resolveMessageText("   ", 0), "Describe / analyze this file.");
  });

  it("notes the images that could not be downloaded", () => {
    assert.equal(resolveMessageText("look", 1), "look\n\n(note: 1 attached file could not be downloaded)");
    assert.equal(resolveMessageText("look", 2), "look\n\n(note: 2 attached files could not be downloaded)");
    assert.equal(resolveMessageText("", 1), "Describe / analyze this file.\n\n(note: 1 attached file could not be downloaded)");
  });

  it("ignores a negative drop count", () => {
    assert.equal(resolveMessageText("look", -1), "look");
  });
});

describe("hasRelayableContent", () => {
  it("relays a caption with no images", () => {
    assert.equal(hasRelayableContent("hello", 0), true);
  });

  it("relays images with no caption — the bug in #2952", () => {
    assert.equal(hasRelayableContent("", 1), true);
    assert.equal(hasRelayableContent("   ", 2), true);
  });

  it("ignores a bare mention carrying neither", () => {
    assert.equal(hasRelayableContent("", 0), false);
    assert.equal(hasRelayableContent("  ", 0), false);
  });
});

describe("isLostImagesOnly", () => {
  it("is true when no image survived and there is no caption", () => {
    assert.equal(isLostImagesOnly("", 0), true);
  });

  it("is false while a caption can carry the turn", () => {
    assert.equal(isLostImagesOnly("look at this", 0), false);
  });

  it("is false once at least one image is in hand", () => {
    assert.equal(isLostImagesOnly("", 1), false);
  });
});

describe("fitBudget", () => {
  const entry = (chars: number) => ({ data: "x".repeat(chars) });

  it("keeps everything that fits", () => {
    const kept = fitBudget([entry(10), entry(20)]);
    assert.equal(kept.length, 2);
  });

  it("stops at the budget the server enforces", () => {
    // Four images at the bridge's 8 MB cap: ~10.7 MB of base64 each.
    const perImage = Math.ceil((8 * 1024 * 1024) / 3) * 4;
    const kept = fitBudget([entry(perImage), entry(perImage), entry(perImage), entry(perImage)]);
    const total = kept.reduce((sum, item) => sum + item.data.length, 0);
    assert.equal(kept.length, 1, "only one 10.7 MB image fits in the 20 MB budget alongside… nothing else that big");
    assert.equal(total <= MAX_TOTAL_BASE64_CHARS, true);
  });

  it("skips one oversized image but keeps a small one after it", () => {
    const kept = fitBudget([entry(MAX_TOTAL_BASE64_CHARS - 5), entry(100), entry(3)]);
    assert.deepEqual(
      kept.map((item) => item.data.length),
      [MAX_TOTAL_BASE64_CHARS - 5, 3],
    );
  });

  it("returns an empty list for no images", () => {
    assert.deepEqual(fitBudget([]), []);
  });
});
