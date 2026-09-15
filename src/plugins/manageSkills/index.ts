import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, type SkillsEndpoints } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiGet } from "../../utils/api";
import { makeUuid } from "../../utils/id";
import type { SkillSource } from "../../types/session";

export interface SkillSummary {
  name: string;
  description: string;
  source: SkillSource;
}

// Full active-skill detail returned by GET /api/skills/:name. Shared by
// View.vue (fetch + edit state) and SkillDetailPane.vue (rendering).
export interface SkillDetail {
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  path: string;
}

export interface ManageSkillsData {
  skills: SkillSummary[];
}

const manageSkillsPlugin: ToolPlugin<ManageSkillsData> = {
  toolDefinition,
  async execute() {
    // Claude invokes this tool to show the user their skills list.
    // The server exposes GET /api/skills (discovery + merge); we just
    // shape it for the View component.
    const endpoints = pluginEndpoints<SkillsEndpoints>("skills");
    const result = await apiGet<{ skills: SkillSummary[] }>(endpoints.list.url);
    if (!result.ok) {
      return {
        toolName: TOOL_NAME,
        uuid: makeUuid(),
        message: `Failed to load skills: ${result.error}`,
        error: `Failed to load skills: ${result.error}`,
      };
    }
    const { skills } = result.data;
    return {
      toolName: TOOL_NAME,
      uuid: makeUuid(),
      title: "Skills",
      message: `Found ${skills.length} skill${skills.length === 1 ? "" : "s"}.`,
      data: { skills },
    };
  },
  isEnabled: () => true,
  generatingMessage: "Loading skills…",
  viewComponent: wrapWithScope("skills", View),
  previewComponent: wrapWithScope("skills", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: manageSkillsPlugin,
};
