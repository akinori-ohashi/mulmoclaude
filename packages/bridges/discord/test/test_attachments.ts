import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectAttachments,
  downloadAttachment,
  isDiscordCdnUrl,
  resolveMessageText,
  resolveMimeType,
  base64Length,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_BASE64_CHARS,
  type DiscordAttachmentLike,
  type FetchFn,
} from "../src/attachments.ts";

const silentLog = { warn: () => {} };

const CDN = "https://cdn.discordapp.com/attachments/1/2/shot.png";

function file(overrides: Partial<DiscordAttachmentLike> = {}): DiscordAttachmentLike {
  return { url: CDN, name: "shot.png", size: 4, contentType: "image/png", ...overrides };
}

interface StubResponseInit {
  status?: number;
  headers?: Record<string, string>;
}

/** A fetch that answers every URL with the same body. */
function stubFetch(body: Uint8Array<ArrayBuffer>, init: StubResponseInit = {}): FetchFn & { calls: string[] } {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    return new Response(body, init);
  };
  return Object.assign(fetchFn, { calls });
}

describe("isDiscordCdnUrl", () => {
  it("accepts the CDN hosts Discord serves attachments from", () => {
    assert.equal(isDiscordCdnUrl(CDN), true);
    assert.equal(isDiscordCdnUrl("https://media.discordapp.net/attachments/1/2/a.png"), true);
    assert.equal(isDiscordCdnUrl("https://images-ext-1.discordapp.net/x.png"), true);
  });

  it("refuses anything that is not a Discord host", () => {
    assert.equal(isDiscordCdnUrl("https://evil.example.com/a.png"), false);
    // A lookalike that merely ends with the brand, without the dot.
    assert.equal(isDiscordCdnUrl("https://notdiscordapp.com/a.png"), false);
    // The suffix as a prefix of an attacker-controlled domain.
    assert.equal(isDiscordCdnUrl("https://cdn.discordapp.com.evil.example/a.png"), false);
  });

  it("refuses non-https schemes and internal targets", () => {
    assert.equal(isDiscordCdnUrl("http://cdn.discordapp.com/a.png"), false);
    assert.equal(isDiscordCdnUrl("file:///etc/passwd"), false);
    assert.equal(isDiscordCdnUrl("https://127.0.0.1/a.png"), false);
    assert.equal(isDiscordCdnUrl("http://169.254.169.254/latest/meta-data/"), false);
  });

  it("refuses a malformed URL instead of throwing", () => {
    assert.equal(isDiscordCdnUrl(""), false);
    assert.equal(isDiscordCdnUrl("not a url"), false);
  });
});

describe("resolveMimeType", () => {
  it("uses the type Discord declares, without its parameters", () => {
    assert.equal(resolveMimeType(file({ contentType: "text/plain; charset=utf-8" })), "text/plain");
    assert.equal(resolveMimeType(file({ contentType: "IMAGE/PNG" })), "image/png");
  });

  it("falls back to the filename extension when Discord declares nothing", () => {
    assert.equal(resolveMimeType(file({ contentType: null, name: "spec.pdf" })), "application/pdf");
    assert.equal(resolveMimeType(file({ contentType: "", name: "photo.JPG" })), "image/jpeg");
  });

  it("falls back to octet-stream for an unknown or missing extension", () => {
    assert.equal(resolveMimeType(file({ contentType: null, name: "archive.zzz" })), "application/octet-stream");
    assert.equal(resolveMimeType(file({ contentType: null, name: "README" })), "application/octet-stream");
    assert.equal(resolveMimeType(file({ contentType: null, name: "trailing." })), "application/octet-stream");
  });
});

describe("downloadAttachment", () => {
  it("returns the bytes as base64 with the filename kept", async () => {
    const fetchFn = stubFetch(new Uint8Array([1, 2, 3]));
    const got = await downloadAttachment(file({ size: 3 }), { fetchFn, log: silentLog });
    assert.deepEqual(got, { mimeType: "image/png", data: Buffer.from([1, 2, 3]).toString("base64"), filename: "shot.png" });
    assert.deepEqual(fetchFn.calls, [CDN]);
  });

  it("never fetches a URL outside the Discord CDN", async () => {
    const fetchFn = stubFetch(new Uint8Array([1]));
    const got = await downloadAttachment(file({ url: "https://evil.example.com/a.png" }), { fetchFn, log: silentLog });
    assert.equal(got, null);
    assert.deepEqual(fetchFn.calls, []);
  });

  it("skips a file Discord declares as over the cap without fetching it", async () => {
    const fetchFn = stubFetch(new Uint8Array([1]));
    const got = await downloadAttachment(file({ size: MAX_ATTACHMENT_BYTES + 1 }), { fetchFn, log: silentLog });
    assert.equal(got, null);
    assert.deepEqual(fetchFn.calls, []);
  });

  it("drops a body that exceeds the cap even when the declared size lied", async () => {
    const fetchFn = stubFetch(new Uint8Array(MAX_ATTACHMENT_BYTES + 1));
    const got = await downloadAttachment(file({ size: 10 }), { fetchFn, log: silentLog });
    assert.equal(got, null);
  });

  it("drops a body whose content-length header exceeds the cap", async () => {
    const fetchFn = stubFetch(new Uint8Array([1]), { headers: { "content-length": String(MAX_ATTACHMENT_BYTES + 1) } });
    const got = await downloadAttachment(file({ size: 10 }), { fetchFn, log: silentLog });
    assert.equal(got, null);
  });

  it("releases the connection when the declared length is over the cap", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchFn: FetchFn = async () => new Response(body, { headers: { "content-length": String(MAX_ATTACHMENT_BYTES + 1) } });
    assert.equal(await downloadAttachment(file({ size: 10 }), { fetchFn, log: silentLog }), null);
    assert.equal(cancelled, true, "an undrained body leaks the connection until it times out");
  });

  it("returns null on a non-2xx response", async () => {
    const fetchFn = stubFetch(new Uint8Array([1]), { status: 404 });
    assert.equal(await downloadAttachment(file(), { fetchFn, log: silentLog }), null);
  });

  it("returns null when the fetch throws", async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error("network down");
    };
    assert.equal(await downloadAttachment(file(), { fetchFn, log: silentLog }), null);
  });
});

describe("collectAttachments", () => {
  it("keeps every downloadable file and reports none dropped", async () => {
    const fetchFn = stubFetch(new Uint8Array([7]));
    const got = await collectAttachments([file(), file({ name: "b.png" })], { fetchFn, log: silentLog });
    assert.equal(got.attachments.length, 2);
    assert.equal(got.dropped, 0);
  });

  it("counts a failed download as dropped and keeps the rest", async () => {
    const fetchFn: FetchFn = async (url) => (url.endsWith("bad.png") ? new Response(null, { status: 500 }) : new Response(new Uint8Array([1])));
    const got = await collectAttachments([file(), file({ name: "bad.png", url: `${CDN}/bad.png` })], { fetchFn, log: silentLog });
    assert.equal(got.attachments.length, 1);
    assert.equal(got.dropped, 1);
  });

  it("stops at the count the server would accept and reports the excess", async () => {
    const fetchFn = stubFetch(new Uint8Array([1]));
    const files = Array.from({ length: MAX_ATTACHMENT_COUNT + 3 }, (_, i) => file({ name: `f${i}.png` }));
    const got = await collectAttachments(files, { fetchFn, log: silentLog });
    assert.equal(got.attachments.length, MAX_ATTACHMENT_COUNT);
    assert.equal(got.dropped, 3);
    assert.equal(fetchFn.calls.length, MAX_ATTACHMENT_COUNT);
  });

  it("returns an empty result for a message with no files", async () => {
    const fetchFn = stubFetch(new Uint8Array([1]));
    assert.deepEqual(await collectAttachments([], { fetchFn, log: silentLog }), { attachments: [], dropped: 0 });
  });

  // chat-service's parseAttachments stops at 20 MB of base64 and says
  // nothing, so files past that would vanish without the user hearing.
  it("stops at the base64 budget the server enforces, and counts the rest", async () => {
    const fetchFn = stubFetch(new Uint8Array([1]));
    const big = MAX_ATTACHMENT_BYTES; // 8 MB → ~10.7 MB of base64
    const files = [file({ name: "a.png", size: big }), file({ name: "b.png", size: big }), file({ name: "c.png", size: big })];
    const got = await collectAttachments(files, { fetchFn, log: silentLog });
    assert.equal(base64Length(big) * 2 > MAX_TOTAL_BASE64_CHARS, true, "two of these must not fit — otherwise this test proves nothing");
    assert.equal(got.attachments.length, 1);
    assert.equal(got.dropped, 2);
    assert.equal(fetchFn.calls.length, 1, "the files that cannot be sent are never downloaded");
  });

  it("still holds the budget when Discord under-reports a file's size", async () => {
    // `withinBudget` trusts the declared size; this pins that the bytes
    // actually downloaded are re-checked, so the server never has to
    // truncate silently.
    const oversized = new Uint8Array(3 * 1024 * 1024); // ~4 MB of base64 each
    const fetchFn = stubFetch(oversized);
    const files = Array.from({ length: 6 }, (_, i) => file({ name: `f${i}.png`, size: 1 })); // all claim 1 byte
    const got = await collectAttachments(files, { fetchFn, log: silentLog });
    const total = got.attachments.reduce((sum, entry) => sum + (entry.data?.length ?? 0), 0);
    assert.equal(total <= MAX_TOTAL_BASE64_CHARS, true, `forwarded ${total} chars, over the ${MAX_TOTAL_BASE64_CHARS} budget`);
    assert.equal(got.attachments.length + got.dropped, files.length, "every file is either forwarded or counted as dropped");
  });

  it("keeps a small file that still fits after a big one was skipped", async () => {
    const fetchFn = stubFetch(new Uint8Array([1]));
    const files = [
      file({ name: "big.png", size: MAX_ATTACHMENT_BYTES }),
      file({ name: "huge.png", size: MAX_ATTACHMENT_BYTES }),
      file({ name: "tiny.png", size: 10 }),
    ];
    const got = await collectAttachments(files, { fetchFn, log: silentLog });
    assert.equal(got.attachments.length, 2, "big + tiny fit; huge does not");
    assert.equal(got.dropped, 1);
  });
});

describe("base64Length", () => {
  it("matches what Buffer.toString('base64') actually produces", () => {
    [0, 1, 2, 3, 4, 5, 6, 100, 1023, 4096].forEach((size) => {
      assert.equal(base64Length(size), Buffer.alloc(size).toString("base64").length, `size ${size}`);
    });
  });
});

describe("resolveMessageText", () => {
  it("keeps the user's text when nothing was lost", () => {
    assert.equal(resolveMessageText("  what is this?  ", 0), "what is this?");
  });

  it("substitutes a prompt for a file-only post — chat-service rejects an empty text", () => {
    assert.equal(resolveMessageText("", 0), "Describe / analyze this file.");
    assert.equal(resolveMessageText("   ", 0), "Describe / analyze this file.");
  });

  it("notes the files that could not be downloaded", () => {
    assert.equal(resolveMessageText("look", 1), "look\n\n(note: 1 attached file could not be downloaded)");
    assert.equal(resolveMessageText("look", 2), "look\n\n(note: 2 attached files could not be downloaded)");
    assert.equal(resolveMessageText("", 1), "Describe / analyze this file.\n\n(note: 1 attached file could not be downloaded)");
  });
});
