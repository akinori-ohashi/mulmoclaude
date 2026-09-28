import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, type ImageToolData } from "./definition";
import { makeGuardedImageExecute } from "../imageRouteResult";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";

const editImagesPlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  execute: makeGuardedImageExecute<ImageToolData>("edit", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Editing images...",
  viewComponent: wrapWithScope("image", View),
  previewComponent: wrapWithScope("image", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: editImagesPlugin,
};
