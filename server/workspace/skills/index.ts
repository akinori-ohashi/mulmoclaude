// Public API for the skills module: discovery, which reads every scope, and the
// writers, which touch the project scope only.

export { discoverSkills, collectSkillsFromDir } from "./discovery.js";
export { parseSkillFrontmatter } from "./parser.js";
export { saveProjectSkill, updateProjectSkill, deleteProjectSkill } from "./writer.js";
export type { SaveResult, UpdateResult, DeleteResult } from "./writer.js";
export { isValidSlug } from "../../utils/slug.js";
export { projectSkillsDir, projectSkillPath, projectSkillDir } from "./paths.js";
export type { Skill, SkillSource, SkillSummary } from "./types.js";
