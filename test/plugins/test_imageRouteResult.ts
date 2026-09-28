// The image route's answer is checked before the view renders it, so this pins
// both directions: every shape the route actually sends must pass, and a body
// that is not this tool's must be refused rather than half-trusted.
//
// The accepted shapes are taken from `server/api/routes/image.ts` — a success
// carries `message`, `instructions`, `title` and `data: { imageData, prompt }`,
// and the no-image case carries `message` alone — plus the `toolName` / `uuid`
// that `makePostExecute` stamps on the way back.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isImageRouteResult } from "../../src/plugins/imageRouteResult.ts";

describe("isImageRouteResult — what the route sends", () => {
  it("accepts a generated image, as the route and the executor build it", () => {
    assert.equal(
      isImageRouteResult({
        toolName: "generateImage",
        uuid: "1234",
        message: "Saved image to images/a.png",
        instructions: "Acknowledge that the image was generated and has been presented to the user.",
        title: "Generated Image",
        data: { imageData: "images/a.png", prompt: "a cat" },
      }),
      true,
    );
  });

  // The route answers 200 with a message and no `data` when the model returned
  // no image — a refusal, typically. That is a result to show, not an error.
  it("accepts the no-image answer, which carries a message and nothing else", () => {
    assert.equal(isImageRouteResult({ message: "no image data in response" }), true);
  });

  it("accepts a prompt-less payload, since the field is optional", () => {
    assert.equal(isImageRouteResult({ message: "", data: { imageData: "images/a.png" } }), true);
  });

  it("accepts the protocol's own optional flags", () => {
    assert.equal(
      isImageRouteResult({ message: "m", action: "open", instructionsRequired: true, updating: false, cancelled: false, viewState: { zoom: 2 } }),
      true,
    );
  });
});

describe("isImageRouteResult — what it refuses", () => {
  it("refuses a body with no message", () => {
    assert.equal(isImageRouteResult({ data: { imageData: "images/a.png" } }), false);
  });

  it("refuses a message that is not a string", () => {
    assert.equal(isImageRouteResult({ message: 42 }), false);
  });

  // The field the view reads. Without this check it renders an empty image.
  it("refuses data without a string imageData", () => {
    assert.equal(isImageRouteResult({ message: "m", data: {} }), false);
    assert.equal(isImageRouteResult({ message: "m", data: { imageData: 7 } }), false);
    assert.equal(isImageRouteResult({ message: "m", data: "images/a.png" }), false);
  });

  // An empty path renders an empty image: the shape is right and the panel is
  // still blank, which is the case this guard is for. "No image" is a body
  // with no `data`, covered above.
  it("refuses an empty imageData", () => {
    assert.equal(isImageRouteResult({ message: "m", data: { imageData: "" } }), false);
    assert.equal(isImageRouteResult({ message: "m", data: { imageData: "", prompt: "a cat" } }), false);
  });

  it("refuses a prompt that is not a string", () => {
    assert.equal(isImageRouteResult({ message: "m", data: { imageData: "images/a.png", prompt: 7 } }), false);
  });

  // This tool sends nothing structured to the LLM — its result type says so —
  // and a body that carries jsonData is answering for some other tool.
  it("refuses a body carrying jsonData", () => {
    assert.equal(isImageRouteResult({ message: "m", jsonData: { rows: [] } }), false);
  });

  it("refuses wrong types on the optional fields", () => {
    assert.equal(isImageRouteResult({ message: "m", title: 7 }), false);
    assert.equal(isImageRouteResult({ message: "m", toolName: 7 }), false);
    assert.equal(isImageRouteResult({ message: "m", updating: "yes" }), false);
    assert.equal(isImageRouteResult({ message: "m", viewState: "big" }), false);
  });

  it("refuses what is not an object at all", () => {
    for (const value of [null, undefined, "", "ok", 0, 1, true, [], [{ message: "m" }]]) {
      assert.equal(isImageRouteResult(value), false, `accepted ${JSON.stringify(value)}`);
    }
  });
});
