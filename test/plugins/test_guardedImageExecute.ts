// The guard at the boundary it actually runs at (#3287, Codex round 1).
//
// `test_imageRouteResult.ts` pins the predicate. This pins the executor both plugins on the
// `image` scope now use: that the route's answer is checked before it is returned, that a body
// which is not the contract's becomes a message instead of a blank panel, and that the two
// answers the route legitimately sends still pass through untouched.
//
// Without this, the mutation `if (isImageRouteResult(result)) return result;` → `return result;`
// leaves every predicate test green, which is the hole this file exists to close.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { makeGuardedImageExecute, IMAGE_ROUTE_REFUSAL } from "../../src/plugins/imageRouteResult.ts";
import { installHostContext, type EndpointRegistry } from "../../src/plugins/api.ts";
import { backendReachable, lastBackendError } from "../../src/utils/api.ts";

interface ImageData {
  imageData: string;
  prompt: string;
}

const imageUrls = { generate: "/api/generate-image", edit: "/api/edit-image", upload: "/api/upload-image", update: "/api/update-image" };
const registry: EndpointRegistry = { image: imageUrls };

let calls: string[] = [];
let nextResponse: () => Response = () => new Response("{}", { status: 200 });
const originalFetch = globalThis.fetch;

const replyWith = (status: number, body: unknown): void => {
  nextResponse = () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
};

const install = (): void => {
  installHostContext({ endpoints: registry, builtinRoleIds: {}, pageRoutes: {}, getAllPluginNames: () => [], chatModels: [] });
  calls = [];
  globalThis.fetch = (url) => {
    calls.push(String(url));
    return Promise.resolve(nextResponse());
  };
};

const restore = (): void => {
  globalThis.fetch = originalFetch;
  backendReachable.value = true;
  lastBackendError.value = null;
};

describe("makeGuardedImageExecute — the answers the route legitimately sends", () => {
  beforeEach(install);
  afterEach(restore);

  it("passes a generated image through, with its data intact", async () => {
    replyWith(200, { message: "Saved image to images/a.png", title: "Generated Image", data: { imageData: "images/a.png", prompt: "a cat" } });

    const result = await makeGuardedImageExecute<ImageData>("generate", "generateImage")({}, { prompt: "a cat" });

    assert.equal(result.message, "Saved image to images/a.png");
    assert.deepEqual(result.data, { imageData: "images/a.png", prompt: "a cat" });
    assert.equal(result.toolName, "generateImage");
    assert.deepEqual(calls, ["/api/generate-image"]);
  });

  // 200 with a message and no `data` is what the route answers when the model returned no image —
  // a refusal to show, not a body to replace.
  it("passes the no-image answer through rather than calling it unrecognized", async () => {
    replyWith(200, { message: "no image data in response" });

    const result = await makeGuardedImageExecute<ImageData>("generate", "generateImage")({}, { prompt: "a cat" });

    assert.equal(result.message, "no image data in response");
    assert.equal(result.data, undefined);
  });

  it("reaches the url of the key it was given", async () => {
    replyWith(200, { message: "Saved image to images/b.png", data: { imageData: "images/b.png", prompt: "brighter" } });

    await makeGuardedImageExecute<ImageData>("edit", "editImages")({}, { prompt: "brighter", imagePaths: ["images/a.png"] });

    assert.deepEqual(calls, ["/api/edit-image"]);
  });

  // The failure convention in `src/plugins/execute.ts` already produces `{ toolName, uuid,
  // message }`, which is a shape this guard must not swallow: the route's reason is the whole
  // value of that branch.
  it("keeps the failure message from a non-2xx rather than replacing it", async () => {
    replyWith(500, { success: false, message: "gemini is unavailable" });

    const result = await makeGuardedImageExecute<ImageData>("generate", "generateImage")({}, { prompt: "a cat" });

    assert.notEqual(result.message, IMAGE_ROUTE_REFUSAL);
    assert.equal(typeof result.message, "string");
    assert.equal(result.data, undefined);
  });
});

describe("makeGuardedImageExecute — a body the route was not supposed to send", () => {
  beforeEach(install);
  afterEach(restore);

  // The case the guard exists for: shape right, panel blank.
  it("refuses an empty imageData and says so instead", async () => {
    replyWith(200, { message: "Saved image to ", data: { imageData: "", prompt: "a cat" } });

    const result = await makeGuardedImageExecute<ImageData>("generate", "generateImage")({}, { prompt: "a cat" });

    assert.equal(result.message, IMAGE_ROUTE_REFUSAL);
    assert.equal(result.data, undefined);
    assert.equal(result.toolName, "generateImage");
    assert.match(result.uuid ?? "", /^[0-9a-f-]{36}$/);
  });

  it("refuses a body with no message", async () => {
    replyWith(200, { data: { imageData: "images/a.png", prompt: "a cat" } });

    const result = await makeGuardedImageExecute<ImageData>("generate", "generateImage")({}, { prompt: "a cat" });

    assert.equal(result.message, IMAGE_ROUTE_REFUSAL);
  });

  it("refuses a body answering for another tool, carrying jsonData", async () => {
    replyWith(200, { message: "here are the rows", jsonData: { rows: [] } });

    const result = await makeGuardedImageExecute<ImageData>("generate", "generateImage")({}, { prompt: "a cat" });

    assert.equal(result.message, IMAGE_ROUTE_REFUSAL);
  });

  // Both plugins share the route, so both must refuse the same body.
  it("refuses it on the edit key too, under the editing tool's name", async () => {
    replyWith(200, { message: "m", data: { imageData: "" } });

    const result = await makeGuardedImageExecute<ImageData>("edit", "editImages")({}, { prompt: "brighter", imagePaths: ["images/a.png"] });

    assert.equal(result.message, IMAGE_ROUTE_REFUSAL);
    assert.equal(result.toolName, "editImages");
  });
});
