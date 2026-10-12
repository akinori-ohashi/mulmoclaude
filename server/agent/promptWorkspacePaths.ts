import { CONTAINER_WORKSPACE_PATH } from "./containerPaths.js";

export interface PromptWorkspacePaths {
  /** The path the agent sees and uses in tool calls — the container mount under Docker. */
  agentWorkspacePath: string;
  /** The path the server process reads prompt inputs from — always the real host path. */
  hostWorkspacePath: string;
}

export function promptWorkspacePaths(hostWorkspacePath: string, useDocker: boolean): PromptWorkspacePaths {
  return { agentWorkspacePath: useDocker ? CONTAINER_WORKSPACE_PATH : hostWorkspacePath, hostWorkspacePath };
}
