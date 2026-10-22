// How MulmoClaude reads the workbook path a chart's `source` names. The
// spreadsheet tool reports `artifacts/spreadsheets/…json`, but the agent may
// also name the file by its host path or, in the Docker sandbox, by its
// container path.

import path from "node:path";
import { isRecord } from "@mulmoclaude/common";
import { toPosixRelPath } from "@mulmoclaude/core/files";

/** `path`, `path.posix` or `path.win32`: the path rules of one platform. */
type PathApi = typeof path.posix;

export interface WorkspaceRoots {
  /** The workspace on the host, where the server reads it. */
  host: string;
  /** The same workspace inside the agent's Docker sandbox (always POSIX). */
  sandbox: string;
}

function relativeWithin(candidate: string, root: string, pathApi: PathApi): string | null {
  if (!pathApi.isAbsolute(candidate)) return null;
  const relative = pathApi.relative(root, candidate);
  const outside = relative === "" || relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative);
  return outside ? null : toPosixRelPath(relative, pathApi.sep);
}

/** The workspace-relative spelling of a workbook path given relative, by its
 *  host path, or by its sandbox path. A path outside the workspace comes back
 *  unchanged, for the spreadsheet package to refuse. */
export function workspaceRelativeWorkbook(spreadsheet: string, roots: WorkspaceRoots, hostPath: PathApi = path): string {
  return relativeWithin(spreadsheet, roots.host, hostPath) ?? relativeWithin(spreadsheet, roots.sandbox, path.posix) ?? spreadsheet;
}

function renameSource(source: unknown, rename: (spreadsheet: string) => string): void {
  if (isRecord(source) && typeof source.spreadsheet === "string") source.spreadsheet = rename(source.spreadsheet);
}

/** Rewrites, in place, the workbook path of every chart entry's `source` and
 *  `sources`. The View follows the path as saved, and file changes are announced
 *  under the workspace-relative one, so a chart saved with another spelling would
 *  never redraw. Leaves anything that is not a chart document alone. */
export function renameChartSources(document: unknown, rename: (spreadsheet: string) => string): void {
  if (!isRecord(document) || !Array.isArray(document.charts)) return;
  document.charts.forEach((entry: unknown) => {
    if (!isRecord(entry)) return;
    renameSource(entry.source, rename);
    if (Array.isArray(entry.sources)) entry.sources.forEach((source: unknown) => renameSource(source, rename));
  });
}
