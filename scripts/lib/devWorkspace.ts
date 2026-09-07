// Which workspace `yarn dev`'s client half is looking at (#2981).
//
// Both halves of the dev client read files out of the workspace — `vite.config.ts`
// takes the session token from it, and the readiness wait takes the published
// port — so they have to agree on WHERE it is. They did not: the config matched
// `^MULMOCLAUDE_WORKSPACE_PATH=(.+)$` by hand while the wait used the launcher's
// `dotenv.parse`. For `MULMOCLAUDE_WORKSPACE_PATH="/tmp/ws"  # scratch` the hand
// match keeps the quotes and the comment, so the two look in different places
// and the config finds neither the token nor the port (Codex, #2981).
//
// Same failure as the one `devServerPort.ts` exists to prevent, one value over:
// a second opinion about what `.env` says. So the rule is borrowed rather than
// written — the VALUES come from the launcher's parser, and `process.env` wins
// over the file exactly as the server's own `MULMOCLAUDE_WORKSPACE_PATH ||`
// default does, empty counting as unset on both sides.
import path from "node:path";
import os from "node:os";

export interface DevWorkspaceSources {
  processEnv?: Record<string, string | undefined>;
  /** `.env` as the launcher's `parseEnvFile` parsed it — NOT raw file text. */
  envFileValues?: Record<string, string> | null;
}

const nonEmpty = (value: string | undefined): value is string => value !== undefined && value.length > 0;

/** Where the workspace lives, resolved the way the server resolves it. */
export const resolveDevWorkspacePath = (sources: DevWorkspaceSources = {}): string => {
  const fromProcess = sources.processEnv?.MULMOCLAUDE_WORKSPACE_PATH;
  if (nonEmpty(fromProcess)) return fromProcess;
  const fromFile = sources.envFileValues?.MULMOCLAUDE_WORKSPACE_PATH;
  if (nonEmpty(fromFile)) return fromFile;
  return path.join(os.homedir(), "mulmoclaude");
};
