// Unit test for `useRawFileDownload`, the browser download on
// FileContentRenderer's binary / unsupported-preview fallback (#3213).
// "Open in OS" spawns a handler on the server's own desktop, so it cannot
// succeed under Docker / WSL2 / a remote host; this is the path that can.
// The composable exists so the request shape, the saved filename and the
// busy/error transitions are testable without mounting the component.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { nextTick, ref } from "vue";
import { useRawFileDownload } from "../../src/composables/useRawFileDownload.ts";

// `Parameters<typeof fetch>` rather than the DOM lib's `RequestInfo`, which is
// not in this project's ESLint globals (same reason src/utils/api.ts does it).
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

interface SavedFile {
  filename: string;
  bytes: string;
}

let fetchedUrls: string[] = [];
let savedFiles: SavedFile[] = [];
let nextStatus = 200;
const SUBTITLE_BODY = "1\n00:00:01,000 --> 00:00:02,000\nhello\n";
let shouldThrow: Error | null = null;
/** When set, a request waits on it before responding — the seam a race needs. */
let holdUntil: Promise<void> | null = null;

const originalFetch = globalThis.fetch;
const originalDocument = Reflect.get(globalThis, "document");
const originalCreateObjectUrl = Reflect.get(URL, "createObjectURL");
const originalRevokeObjectUrl = Reflect.get(URL, "revokeObjectURL");

// `saveBlob` does the createObjectURL -> anchor.click -> revoke dance, which
// needs a document. Node has none, so stand in for just those three calls and
// record what the anchor was asked to save. `defineProperty` rather than a
// cast: the DOM lib types `globalThis.document` as a full Document.
function installDomStubs(): void {
  fetchedUrls = [];
  savedFiles = [];
  nextStatus = 200;
  shouldThrow = null;
  holdUntil = null;

  const blobsByUrl = new Map<string, Blob>();
  let nextUrlId = 0;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (blob: Blob) => {
      nextUrlId += 1;
      const url = `blob:stub/${nextUrlId}`;
      blobsByUrl.set(url, blob);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        const anchor = {
          href: "",
          download: "",
          click: () => {
            const blob = blobsByUrl.get(anchor.href);
            if (!blob) throw new Error(`anchor clicked with an unknown href: ${anchor.href}`);
            // Record synchronously-known facts; the bytes are read below.
            savedFiles.push({ filename: anchor.download, bytes: "" });
            void blob.text().then((text) => {
              const saved = savedFiles[savedFiles.length - 1];
              if (saved) saved.bytes = text;
            });
          },
        };
        return anchor;
      },
    },
  });

  // A real `Response` rather than a hand-shaped stub: the composable reads
  // `ok` and calls `blob()`, and undici's implementation of both is the thing
  // that actually runs in the browser.
  globalThis.fetch = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    fetchedUrls.push(String(input));
    if (shouldThrow) throw shouldThrow;
    if (holdUntil) {
      // Let a test navigate away while this request is still in flight, and
      // reject on abort the way a real fetch does.
      await new Promise<void>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        void holdUntil?.then(resolve);
      });
    }
    return new Response(SUBTITLE_BODY, { status: nextStatus });
  };
}

function restoreDomStubs(): void {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectUrl });
}

describe("useRawFileDownload", () => {
  beforeEach(installDomStubs);
  afterEach(restoreDomStubs);

  it("starts idle", () => {
    const path = ref<string | null>("artifacts/documents/talk.srt");
    const { busy, error } = useRawFileDownload(path, () => "fallback");
    assert.equal(busy.value, false);
    assert.equal(error.value, null);
  });

  it("does nothing when no file is selected", async () => {
    const path = ref<string | null>(null);
    const { busy, error, download } = useRawFileDownload(path, () => "fallback");
    await download();
    assert.equal(fetchedUrls.length, 0);
    assert.equal(busy.value, false);
    assert.equal(error.value, null);
  });

  it("gets the bytes from /api/files/raw with the path percent-encoded", async () => {
    const path = ref<string | null>("artifacts/documents/my talk.srt");
    const { download } = useRawFileDownload(path, () => "fallback");
    await download();
    assert.equal(fetchedUrls.length, 1);
    assert.match(fetchedUrls[0] ?? "", /\/api\/files\/raw\?path=artifacts%2Fdocuments%2Fmy%20talk\.srt$/);
  });

  it("saves under the file's own basename, not the whole path", async () => {
    const path = ref<string | null>("artifacts/documents/talk.srt");
    const { error, download } = useRawFileDownload(path, () => "fallback");
    await download();
    assert.equal(error.value, null);
    assert.equal(savedFiles.length, 1);
    assert.equal(savedFiles[0]?.filename, "talk.srt");
  });

  it("surfaces the failure message on a refused response instead of saving it", async () => {
    // The reason this is a fetch and not an <a download>: a 413 body must not
    // land on disk named talk.srt as though it were the file.
    nextStatus = 413;
    const path = ref<string | null>("big.bin");
    const { busy, error, download } = useRawFileDownload(path, () => "download failed");
    await download();
    assert.equal(error.value, "download failed");
    assert.equal(busy.value, false);
    assert.equal(savedFiles.length, 0);
  });

  it("surfaces the failure message when the request throws", async () => {
    shouldThrow = new Error("offline");
    const path = ref<string | null>("a.bin");
    const { busy, error, download } = useRawFileDownload(path, () => "download failed");
    await download();
    assert.equal(error.value, "download failed");
    assert.equal(busy.value, false);
  });

  it("resets busy and error when the selected file changes", async () => {
    nextStatus = 500;
    const path = ref<string | null>("a.bin");
    const { busy, error, download } = useRawFileDownload(path, () => "download failed");
    await download();
    assert.equal(error.value, "download failed");
    path.value = "b.bin";
    await nextTick();
    assert.equal(busy.value, false);
    assert.equal(error.value, null);
  });

  it("clears a previous error before retrying", async () => {
    nextStatus = 500;
    const path = ref<string | null>("a.bin");
    const { error, download } = useRawFileDownload(path, () => "download failed");
    await download();
    assert.equal(error.value, "download failed");
    nextStatus = 200;
    await download();
    assert.equal(error.value, null);
    assert.equal(savedFiles.length, 1);
  });
});

describe("useRawFileDownload — a download must not outlive its selection", () => {
  beforeEach(installDomStubs);
  afterEach(restoreDomStubs);

  it("does not save file A's bytes after the user has navigated to file B", async () => {
    // Without the guard the response lands whenever it lands, and the browser
    // saves `a.bin` while `b.bin` is the file on screen.
    let release = (): void => {};
    holdUntil = new Promise<void>((resolve) => {
      release = resolve;
    });
    const path = ref<string | null>("a.bin");
    const { busy, error, download } = useRawFileDownload(path, () => "download failed");
    const pending = download();

    path.value = "b.bin";
    await nextTick();
    release();
    await pending;

    assert.equal(savedFiles.length, 0, "the superseded request must not save anything");
    assert.equal(error.value, null, "an abort is not a failure the user should see");
    assert.equal(busy.value, false);
  });

  it("does not resurrect busy or error on the new selection", async () => {
    nextStatus = 500;
    let release = (): void => {};
    holdUntil = new Promise<void>((resolve) => {
      release = resolve;
    });
    const path = ref<string | null>("a.bin");
    const { busy, error, download } = useRawFileDownload(path, () => "download failed");
    const pending = download();

    path.value = "b.bin";
    await nextTick();
    release();
    await pending;

    assert.equal(error.value, null, "file A's 500 must not appear under file B");
    assert.equal(busy.value, false, "file B must not inherit file A's busy state");
  });

  it("a second download on the same file supersedes the first", async () => {
    let release = (): void => {};
    holdUntil = new Promise<void>((resolve) => {
      release = resolve;
    });
    const path = ref<string | null>("a.bin");
    const { download } = useRawFileDownload(path, () => "download failed");
    const first = download();

    holdUntil = null;
    await download();
    release();
    await first;

    assert.equal(savedFiles.length, 1, "only the current request saves");
  });
});
