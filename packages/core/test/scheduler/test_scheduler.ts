import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCHEDULE_TYPES, MISSED_RUN_POLICIES } from "@receptron/task-scheduler";
import {
  createTaskManager,
  configureScheduler,
  initScheduler,
  getSchedulerTasks,
  getSchedulerTaskState,
  getSchedulerLogs,
  recordExternalRun,
  resetSchedulerForTesting,
  TASK_TRIGGERS,
  type ITaskManager,
  type TaskDefinition,
  type SystemTaskDef,
} from "../../src/scheduler/index.ts";
import { collectDueTasks, listTaskSummaries } from "../../src/scheduler/task-manager.ts";

const stubTm = (over: Partial<ITaskManager>): ITaskManager => ({
  registerTask: () => {},
  removeTask: () => {},
  updateSchedule: () => true,
  start: () => {},
  stop: () => {},
  tick: async () => {},
  listTasks: () => [],
  ...over,
});

afterEach(() => resetSchedulerForTesting());

// ── task-manager (tick engine) ────────────────────────────────────

test("tick runs due interval tasks", async () => {
  const ran: string[] = [];
  // A 1-minute interval task is due at UTC midnight (0 ms since midnight).
  const manager = createTaskManager({ tickMs: 60_000, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) });
  manager.registerTask({
    id: "a",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      ran.push("a");
    },
  });
  await manager.tick();
  assert.deepEqual(ran, ["a"]);
});

// #2937: the interval check counted from UTC midnight, so a 168h task was due
// at 00:00 every single day. It must fire on its own epoch-anchored window.
test("a 168h task fires on its weekly window, not every midnight", async () => {
  const ran: string[] = [];
  const register = (manager: ITaskManager) =>
    manager.registerTask({
      id: "weekly",
      schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 168 * 60 * 60 * 1000 },
      run: async () => {
        ran.push("weekly");
      },
    });

  // 2026-08-06T00:00Z is a multiple of 168h from the epoch; the days around it
  // are not, and used to fire all the same.
  const onWindow = createTaskManager({ tickMs: 60_000, now: () => new Date(Date.UTC(2026, 7, 6, 0, 0, 0)) });
  register(onWindow);
  await onWindow.tick();
  assert.deepEqual(ran, ["weekly"]);

  for (const day of [5, 7, 8]) {
    const offWindow = createTaskManager({ tickMs: 60_000, now: () => new Date(Date.UTC(2026, 7, day, 0, 0, 0)) });
    register(offWindow);
    await offWindow.tick();
  }
  assert.deepEqual(ran, ["weekly"], "the weekly task fired on a day that is not its window");
});

test("dependsOn enforces ordering within a tick; dependent skipped if dep fails", async () => {
  const order: string[] = [];
  const manager = createTaskManager({ tickMs: 60_000, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) });
  manager.registerTask({
    id: "dep",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      order.push("dep");
    },
  });
  manager.registerTask({
    id: "child",
    dependsOn: "dep",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      order.push("child");
    },
  });
  await manager.tick();
  assert.deepEqual(order, ["dep", "child"]);

  const order2: string[] = [];
  const tm2 = createTaskManager({ tickMs: 60_000, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) });
  tm2.registerTask({
    id: "dep",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      throw new Error("boom");
    },
  });
  tm2.registerTask({
    id: "child",
    dependsOn: "dep",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      order2.push("child");
    },
  });
  await tm2.tick();
  assert.deepEqual(order2, []); // child never runs because dep did not succeed
});

test("staggers the start of independently-due tasks by firingStaggerMs (#2057)", async () => {
  const requestedDelays: number[] = [];
  const ran: string[] = [];
  const manager = createTaskManager({
    tickMs: 60_000,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
    firingStaggerMs: 500,
    sleep: async (delayMs) => {
      requestedDelays.push(delayMs);
    },
  });
  for (const taskId of ["a", "b", "c"]) {
    manager.registerTask({
      id: taskId,
      schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
      run: async () => {
        ran.push(taskId);
      },
    });
  }
  await manager.tick();
  assert.deepEqual(ran.sort(), ["a", "b", "c"]); // every due task still runs this tick
  // First task starts immediately (no sleep); the rest are offset by index * gap.
  assert.deepEqual(requestedDelays, [500, 1000]);
});

test("caps the total stagger to half a tick so tasks never spill into the next tick (#2057)", async () => {
  // Debug-mode shape: tickMs == firingStaggerMs. Without the cap the 2nd task
  // would start a full tick late and ticks would overlap. The cap shrinks the
  // step to (tickMs * 0.5) / (count - 1) = (1000 * 0.5) / 2 = 250ms.
  const requestedDelays: number[] = [];
  const manager = createTaskManager({
    tickMs: 1000,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
    firingStaggerMs: 1000,
    sleep: async (delayMs) => {
      requestedDelays.push(delayMs);
    },
  });
  for (const taskId of ["a", "b", "c"]) {
    manager.registerTask({
      id: taskId,
      schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 1000 },
      run: async () => {},
    });
  }
  await manager.tick();
  assert.deepEqual(requestedDelays, [250, 500]);
  assert.ok(Math.max(...requestedDelays) < 1000, "last start stays within the tick");
});

test("firingStaggerMs: 0 fires all due tasks without any delay", async () => {
  const requestedDelays: number[] = [];
  const manager = createTaskManager({
    tickMs: 60_000,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
    firingStaggerMs: 0,
    sleep: async (delayMs) => {
      requestedDelays.push(delayMs);
    },
  });
  for (const taskId of ["a", "b"]) {
    manager.registerTask({
      id: taskId,
      schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
      run: async () => {},
    });
  }
  await manager.tick();
  assert.deepEqual(requestedDelays, []);
});

test("registerTask rejects duplicate ids; updateSchedule returns false for unknown", () => {
  const manager = createTaskManager();
  manager.registerTask({ id: "a", schedule: { type: SCHEDULE_TYPES.daily, time: "09:00" }, run: async () => {} });
  assert.throws(() => manager.registerTask({ id: "a", schedule: { type: SCHEDULE_TYPES.daily, time: "10:00" }, run: async () => {} }));
  assert.equal(manager.updateSchedule("missing", { type: SCHEDULE_TYPES.daily, time: "10:00" }), false);
  assert.equal(manager.updateSchedule("a", { type: SCHEDULE_TYPES.daily, time: "10:00" }), true);
});

// ── pure helpers extracted from createTaskManager ─────────────────

const makeDef = (over: Partial<TaskDefinition> & { id: string }): TaskDefinition => ({
  schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
  run: async () => {},
  ...over,
});

test("listTaskSummaries strips run and keeps the summary fields", () => {
  const registry = new Map<string, TaskDefinition>();
  assert.deepEqual(listTaskSummaries(registry), []);
  registry.set("a", makeDef({ id: "a", description: "d", dependsOn: "b" }));
  const [summary] = listTaskSummaries(registry);
  assert.deepEqual(summary, {
    id: "a",
    description: "d",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    dependsOn: "b",
  });
  assert.equal("run" in summary, false);
});

test("collectDueTasks partitions due tasks and skips disabled/not-due", () => {
  const midnight = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  const registry = new Map<string, TaskDefinition>();
  registry.set("indep", makeDef({ id: "indep" }));
  registry.set("dep", makeDef({ id: "dep", dependsOn: "indep" }));
  registry.set("off", makeDef({ id: "off", enabled: false }));
  registry.set("notDue", makeDef({ id: "notDue", schedule: { type: SCHEDULE_TYPES.daily, time: "09:00" } }));
  const { independent, dependent } = collectDueTasks(midnight, registry, 60_000);
  assert.deepEqual(
    independent.map((def) => def.id),
    ["indep"],
  );
  assert.deepEqual(
    dependent.map((def) => def.id),
    ["dep"],
  );
});

// ── adapter (catch-up + persistence + state) ──────────────────────

function configure(root: string): void {
  configureScheduler({
    workspaceRoot: root,
    writeFileAtomic: async (filePath, content) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    },
  });
}

test("initScheduler registers system tasks with the task-manager and exposes their state", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sched-"));
  try {
    configure(root);
    const registered: string[] = [];
    const fakeTm = stubTm({
      registerTask: (def: TaskDefinition) => {
        registered.push(def.id);
      },
    });
    const tasks: SystemTaskDef[] = [
      {
        id: "system:journal",
        name: "Journal",
        description: "d",
        schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 3_600_000 },
        missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
        run: async () => {},
      },
    ];
    await initScheduler(fakeTm, tasks);
    assert.deepEqual(registered, ["system:journal"]);
    const states = getSchedulerTasks();
    assert.equal(states.length, 1);
    const [journalState] = states;
    assert.ok(journalState);
    assert.equal(journalState.id, "system:journal");
    // state.json directory was created under the injected workspace root.
    assert.ok(existsSync(path.join(root, "config", "scheduler")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The tick path refuses to fire an unusable schedule, but catch-up runs FIRST
// and enumerates windows from the persisted lastRunAt. For an interval of 0
// those windows come back NaN, `listMissedWindows` fills to its cap, and the
// first `new Date(NaN)` throws — so one bad task aborted startup for all of
// them. Reported by Codex on #2955.
/** Register `tasks` and hand back the run thunk the adapter gave the manager,
 *  plus the ids it registered. */
async function initAndCapture(tasks: SystemTaskDef[]): Promise<{ run: TaskDefinition["run"] | undefined; registered: string[] }> {
  const registered: string[] = [];
  const captured: { run?: TaskDefinition["run"] } = {};
  const fakeTm = stubTm({
    registerTask: (def: TaskDefinition) => {
      registered.push(def.id);
      captured.run = def.run;
    },
  });
  await initScheduler(fakeTm, tasks);
  return { run: captured.run, registered };
}

/** Seed `state.json` so catch-up has a `lastRunAt` to enumerate windows from. */
async function seedState(root: string, state: Record<string, unknown>): Promise<void> {
  await mkdir(path.join(root, "config", "scheduler"), { recursive: true });
  await writeFile(path.join(root, "config", "scheduler", "state.json"), JSON.stringify(state));
}

test("a task with an unusable interval does not take startup down with it", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sched-"));
  try {
    configure(root);
    await seedState(root, { broken: { taskId: "broken", lastRunAt: new Date(Date.now() - 86_400_000).toISOString(), totalRuns: 1 } });

    let ran = 0;
    const { registered } = await initAndCapture([
      {
        id: "broken",
        name: "Broken",
        description: "d",
        schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 0 },
        missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
        run: async () => {
          ran++;
        },
      },
    ]);

    assert.equal(ran, 0, "an unfireable task must not be caught up");
    // Still registered: the task-manager is where the bad schedule is reported.
    assert.deepEqual(registered, ["broken"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// `lastRunAt` is what catch-up measures the next windows from, so it has to be
// the WINDOW the run belongs to, not the wall clock it happened to start at. A
// daily task read a second past its minute used to persist the wall clock.
// Raised by CodeRabbit on #2955.
test("a scheduled run persists the window it belongs to, not the wall clock", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sched-"));
  try {
    configure(root);
    const { run: runThunk } = await initAndCapture([
      {
        id: "system:daily",
        name: "Daily",
        description: "d",
        schedule: { type: SCHEDULE_TYPES.daily, time: "19:00" },
        missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
        run: async () => {},
      },
    ]);
    assert.ok(runThunk, "task-manager received a run thunk");

    const windowMs = Date.UTC(2026, 7, 2, 19, 0, 0);
    await runThunk({ taskId: "system:daily", now: new Date(windowMs + 1_500) });

    assert.equal(getSchedulerTaskState("system:daily").lastRunAt, new Date(windowMs).toISOString());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a scheduled run executes the task and persists state to the injected workspace", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sched-"));
  try {
    configure(root);
    let ran = 0;
    const captured: { run?: TaskDefinition["run"] } = {};
    const fakeTm = stubTm({
      registerTask: (def: TaskDefinition) => {
        captured.run = def.run;
      },
    });
    await initScheduler(fakeTm, [
      {
        id: "system:feed",
        name: "Feed",
        description: "d",
        schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 3_600_000 },
        missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
        run: async () => {
          ran++;
        },
      },
    ]);
    const runThunk = captured.run;
    assert.ok(runThunk, "task-manager received a run thunk");
    await runThunk({ taskId: "system:feed", now: new Date() });
    assert.equal(ran, 1);
    const statePath = path.join(root, "config", "scheduler", "state.json");
    assert.ok(existsSync(statePath));
    const persisted = JSON.parse(readFileSync(statePath, "utf-8"));
    assert.ok(JSON.stringify(persisted).includes("system:feed"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── external (skill / user) runs — #2012 ──────────────────────────

test("recordExternalRun persists state + a log entry, readable via getSchedulerTaskState", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sched-"));
  try {
    configure(root);
    await initScheduler(stubTm({}), []); // no system tasks — just load state + create dirs

    const before = getSchedulerTaskState("skill.news-filter");
    assert.equal(before.totalRuns, 0);
    assert.equal(before.lastRunAt, null);

    // Log files partition by the run's `startedAt` day and getSchedulerLogs
    // reads today's partition, so use a same-day timestamp here.
    const now = new Date().toISOString();
    await recordExternalRun({
      id: "skill.news-filter",
      name: "news-filter",
      schedule: { type: SCHEDULE_TYPES.daily, time: "07:30" },
      scheduledFor: now,
      startedAt: now,
      durationMs: 5,
      trigger: TASK_TRIGGERS.scheduled,
      errorMessage: null,
      chatSessionId: "chat-123",
    });

    const after = getSchedulerTaskState("skill.news-filter");
    assert.equal(after.totalRuns, 1);
    assert.equal(after.lastRunResult, "success");
    assert.equal(after.lastRunAt, now);
    assert.ok(after.nextScheduledAt, "next run computed from the daily schedule");

    const logs = await getSchedulerLogs({ taskId: "skill.news-filter" });
    assert.equal(logs.length, 1);
    const [scheduledLog] = logs;
    assert.ok(scheduledLog);
    assert.equal(scheduledLog.trigger, "scheduled");
    assert.equal(scheduledLog.chatSessionId, "chat-123");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordExternalRun records a failed dispatch as an error run", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sched-"));
  try {
    configure(root);
    await initScheduler(stubTm({}), []);
    const now = new Date().toISOString();
    await recordExternalRun({
      id: "user.abc",
      name: "my task",
      schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 3_600_000 },
      scheduledFor: now,
      startedAt: now,
      durationMs: 1,
      trigger: TASK_TRIGGERS.manual,
      errorMessage: "too many background sessions",
    });
    const state = getSchedulerTaskState("user.abc");
    assert.equal(state.lastRunResult, "error");
    assert.equal(state.lastErrorMessage, "too many background sessions");
    assert.equal(state.consecutiveFailures, 1);
    const [errorLog] = await getSchedulerLogs({ taskId: "user.abc" });
    assert.ok(errorLog);
    assert.equal(errorLog.result, "error");
    assert.equal(errorLog.errorMessage, "too many background sessions");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// `makeGuardedTick` has a `finally` but no `catch`, so a tick that rejects
// propagates. Awaiting `tick()` hands that to the caller, which is fine — but
// `start()` drives the same function from `setInterval`, where a rejection has
// nowhere to go and the host turns it into a process exit. One bad tick used to
// be able to take the server down; this pins that it no longer can, and that
// the interval keeps firing afterwards.
test("start(): a rejected tick is logged and later ticks keep running", async () => {
  const errors: string[] = [];
  let nowCalls = 0;
  const manager = createTaskManager({
    tickMs: 5,
    log: { info: () => {}, warn: () => {}, error: (message) => errors.push(message) },
    // `runTick` calls `now()` first thing, so throwing here rejects the tick
    // itself rather than an individual task (those are caught per-task).
    now: () => {
      nowCalls += 1;
      throw new Error("clock exploded");
    },
  });

  manager.start();
  await new Promise((resolve) => setTimeout(resolve, 60));
  manager.stop();

  assert.ok(nowCalls >= 2, `interval stopped after the first rejection (${nowCalls} tick(s))`);
  assert.ok(errors.includes("tick failed"), `expected a "tick failed" log, got ${JSON.stringify(errors)}`);
});

// A daily task whose `time` isn't "HH:MM" is never due — safe, but until
// #2765 it was also completely silent: no log, no error, and `registerTask`
// accepted it. "The task I scheduled has never run once" is the worst
// failure mode to have to debug from nothing. The manager now says so; it
// still registers the task, because throwing would turn a consumer's
// long-dead task into a boot crash.
test("a daily task with a malformed time is reported, not silently dead (#2765)", async () => {
  const errors: { message: string; data?: unknown }[] = [];
  const manager = createTaskManager({
    tickMs: 60_000,
    now: () => new Date(Date.UTC(2026, 0, 1, 9, 0, 0)),
    log: { info: () => {}, warn: () => {}, error: (message, data) => errors.push({ message, data }) },
  });

  const ran: string[] = [];
  manager.registerTask({ id: "typo", schedule: { type: SCHEDULE_TYPES.daily, time: "9" }, run: async () => void ran.push("typo") });

  assert.equal(errors.length, 1, "registering a malformed daily time must report it");
  assert.match(errors[0]?.message ?? "", /never run|never fire/i);
  assert.deepEqual(errors[0]?.data, { id: "typo", time: "9" });

  // Behaviour is unchanged: still registered, still never due.
  await manager.tick();
  assert.deepEqual(ran, [], "a malformed daily time must stay never-due");
});

test("updateSchedule reports a malformed daily time too (#2765)", () => {
  const errors: unknown[] = [];
  const manager = createTaskManager({
    tickMs: 60_000,
    now: () => new Date(Date.UTC(2026, 0, 1, 9, 0, 0)),
    log: { info: () => {}, warn: () => {}, error: (_message, data) => errors.push(data) },
  });
  manager.registerTask({ id: "ok", schedule: { type: SCHEDULE_TYPES.daily, time: "09:00" }, run: async () => {} });
  assert.deepEqual(errors, [], "a well-formed time must not be reported");

  // The override path (`applyScheduleOverride`) reaches this at run time, so
  // checking only at registration would miss a bad value applied later.
  manager.updateSchedule("ok", { type: SCHEDULE_TYPES.daily, time: "0900" });
  assert.deepEqual(errors, [{ id: "ok", time: "0900" }]);
});
