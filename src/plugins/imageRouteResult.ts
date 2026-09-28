// What the host's image routes are allowed to answer, checked before a view renders it.
//
// `makePostExecute` spreads the route's body into the tool result, and the views read
// `data.imageData` out of it — so a 200 whose body is not this contract's reaches the panel as a
// blank image with nothing to explain it. Both plugins on the `image` scope go through here:
// `generateImage` and `editImages` share the route (`respondWithImage` in
// `server/api/routes/image.ts`), the same payload shape, and the same `ui-image` renderer, so a
// guard on one of them only is a guard on half the contract.
//
// Ported from `@mulmochat-plugin/generate-image`, where the same check covers the client-side
// `app.generateImage` callback. Every field the protocol declares is checked rather than only the
// ones read back here, so a body carrying something unexpected is refused rather than
// half-trusted. `jsonData` must be absent: these tools send nothing structured to the LLM.

import type { ToolResult } from "gui-chat-protocol";
import { isRecord } from "../utils/types";
import type { ImageEndpoints } from "./editImages/definition";
import { makePostExecute, type PluginExecute } from "./execute";
import { makeUuid } from "../utils/id";

/** The reply when the route answered with something this contract does not describe. Generic on
 *  purpose: the body it refused is not something to show a user. */
export const IMAGE_ROUTE_REFUSAL = "The image service answered with an unrecognized response.";

const isOptionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";

const isOptionalBoolean = (value: unknown): value is boolean | undefined => value === undefined || typeof value === "boolean";

// `imageData` is the path the view renders, so an empty one is the blank panel this guard exists
// to prevent — the absent case is a body with no `data` at all, which the route sends when the
// model returned no image.
const isImageToolData = (value: unknown): boolean =>
  isRecord(value) && typeof value.imageData === "string" && value.imageData.length > 0 && isOptionalString(value.prompt);

/** Whether `value` is a result the image routes are allowed to have produced. Boolean rather than
 *  a type predicate: the caller already holds the statically typed result and only needs to know
 *  whether the body behind it is this contract's. */
export const isImageRouteResult = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.message === "string" &&
  isOptionalString(value.toolName) &&
  isOptionalString(value.uuid) &&
  isOptionalString(value.title) &&
  isOptionalString(value.action) &&
  isOptionalString(value.instructions) &&
  isOptionalBoolean(value.instructionsRequired) &&
  isOptionalBoolean(value.updating) &&
  isOptionalBoolean(value.cancelled) &&
  value.jsonData === undefined &&
  (value.data === undefined || isImageToolData(value.data)) &&
  (value.viewState === undefined || isRecord(value.viewState));

/** `makePostExecute` over the `image` scope, with the route's answer checked before it is
 *  returned. A body that is not this contract's becomes a message rather than a blank panel. */
export function makeGuardedImageExecute<D>(urlKey: keyof ImageEndpoints & string, toolName: string): PluginExecute<D> {
  const post = makePostExecute<ImageEndpoints, D>("image", urlKey, toolName);
  return async (context, args): Promise<ToolResult<D>> => {
    const result = await post(context, args);
    if (isImageRouteResult(result)) return result;
    return { toolName, uuid: makeUuid(), message: IMAGE_ROUTE_REFUSAL };
  };
}
