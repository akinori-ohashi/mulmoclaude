// Skill scheduling (#357 Phase 2). Scans all discovered skills for
// `schedule:` frontmatter and registers matching ones with the
// task-manager. Each scheduled skill fires `startChat()` with the
// skill body as the message and the skill's `roleId` (or "general").
//
// `refreshScheduledSkills()` can be called at any time to re-scan
// and update registrations (e.g. after a skill is saved/deleted
// via the API). It unregisters stale tasks and registers new ones.

import { discoverSkills } from "./discovery.js";
import type { Skill } from "./types.js";
import type { ITaskManager, TaskSchedule } from "../../events/task-manager/index.js";
import { TASK_TRIGGERS, type TaskTrigger } from "../../events/scheduler-adapter.js";
import { fireScheduledChat } from "./scheduled-run.js";
import { parseSkillFrontmatter } from "./parser.js";
import { log } from "../../system/logger/index.js";
import { readFileSync } from "fs";
import { DEFAULT_ROLE_ID } from "../../../src/config/roles.js";
import { SESSION_ORIGINS, type SessionOrigin } from "../../../src/types/session.js";

interface SkillScheduleInfo {
  schedule: TaskSchedule;
  roleId: string;
}

interface StartChatResult {
  kind: string;
  error?: string;
  status?: number;
}

export interface SkillSchedulerDeps {
  taskManager: ITaskManager;
  workspaceRoot: string;
  startChat: (params: { message: string; roleId: string; chatSessionId: string; origin?: SessionOrigin }) => Promise<StartChatResult>;
}

const SKILL_TASK_PREFIX = "skill.";

interface ScheduledSkillTask {
  id: string;
  name: string;
  description: string;
  schedule: TaskSchedule;
  roleId: string;
}

// Registered skill tasks keyed by task-manager id: refresh unregisters stale
// ones, and the API lists them (origin: "skill") with their schedule + state.
let registeredSkillTasks = new Map<string, ScheduledSkillTask>();
let cachedDeps: SkillSchedulerDeps | null = null;

// Mutex: serialize refresh calls so concurrent save/update/delete
// API calls don't interleave register/unregister and corrupt state.
let refreshMutex: Promise<number> = Promise.resolve(0);

export async function registerScheduledSkills(deps: SkillSchedulerDeps): Promise<number> {
  cachedDeps = deps;
  return serializedRefresh(deps);
}

/**
 * Re-scan skills and update task-manager registrations. Safe to call
 * after a skill is saved, updated, or deleted — removes stale tasks
 * and adds new ones without a server restart. Serialized: concurrent
 * calls queue behind the in-flight one.
 */
export async function refreshScheduledSkills(): Promise<number> {
  if (!cachedDeps) {
    log.warn("skills", "refreshScheduledSkills called before initial register");
    return 0;
  }
  return serializedRefresh(cachedDeps);
}

function serializedRefresh(deps: SkillSchedulerDeps): Promise<number> {
  refreshMutex = refreshMutex.then(
    () => doRegister(deps),
    () => doRegister(deps),
  );
  return refreshMutex;
}

async function doRegister(deps: SkillSchedulerDeps): Promise<number> {
  const { taskManager, workspaceRoot } = deps;

  // Unregister all previously registered skill tasks
  for (const taskId of registeredSkillTasks.keys()) {
    taskManager.removeTask(taskId);
  }
  const previousCount = registeredSkillTasks.size;
  registeredSkillTasks = new Map<string, ScheduledSkillTask>();

  // Plugin skills are excluded: installing a marketplace plugin must not
  // register recurring work the user never asked for, and the schedule lives
  // in frontmatter its author controls.
  const skills = await discoverSkills({ workspaceRoot, includeClaudePlugins: false });

  for (const skill of skills) {
    const info = readSkillScheduleInfo(skill);
    if (!info) continue;

    const task: ScheduledSkillTask = {
      id: `${SKILL_TASK_PREFIX}${skill.name}`,
      name: skill.name,
      description: `Scheduled skill: ${skill.name} — ${skill.description}`,
      schedule: info.schedule,
      roleId: info.roleId,
    };

    taskManager.registerTask({
      id: task.id,
      description: task.description,
      schedule: task.schedule,
      run: async () => {
        await fireSkillTask(task, TASK_TRIGGERS.scheduled);
      },
    });
    registeredSkillTasks.set(task.id, task);
  }

  const registered = registeredSkillTasks.size;
  if (previousCount > 0 || registered > 0) {
    log.info("skills", "skill schedules refreshed", { previous: previousCount, current: registered });
  }
  return registered;
}

// Fire one scheduled skill: dispatch `/skill-name` as a chat and record the run
// (history + last/next-run state) so it shows on the Automations page.
async function fireSkillTask(task: ScheduledSkillTask, trigger: TaskTrigger): Promise<string> {
  if (!cachedDeps) throw new Error("skill scheduler not initialized");
  return fireScheduledChat({
    id: task.id,
    name: task.name,
    schedule: task.schedule,
    message: `/${task.name}`,
    roleId: task.roleId,
    origin: SESSION_ORIGINS.skill,
    trigger,
    logScope: "skills",
    failureLabel: "scheduled skill",
    startChat: cachedDeps.startChat,
  });
}

/** All registered skill tasks, for the Automations list (origin: "skill"). */
export function getScheduledSkills(): { id: string; name: string; description: string; schedule: TaskSchedule }[] {
  return [...registeredSkillTasks.values()].map(({ id, name, description, schedule }) => ({ id, name, description, schedule }));
}

/** Manually fire a registered skill task by its task-manager id (`skill.<name>`).
 *  Returns the spawned chat session id, or null if the id isn't a known skill. */
export async function runScheduledSkillNow(taskId: string): Promise<string | null> {
  const task = registeredSkillTasks.get(taskId);
  if (!task) return null;
  return fireSkillTask(task, TASK_TRIGGERS.manual);
}

// Read schedule + roleId in one file read (avoid reading the same
// SKILL.md twice). Returns null if no schedule is configured.
function readSkillScheduleInfo(skill: Skill): SkillScheduleInfo | null {
  try {
    const raw = readFileSync(skill.path, "utf-8");
    const parsed = parseSkillFrontmatter(raw);
    const schedule = parsed?.schedule?.parsed;
    if (!schedule) return null;
    return {
      schedule,
      roleId: parsed?.roleId ?? DEFAULT_ROLE_ID,
    };
  } catch {
    return null;
  }
}
