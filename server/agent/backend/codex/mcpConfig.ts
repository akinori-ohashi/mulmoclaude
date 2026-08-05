import { isRecord } from "../../../utils/types.js";

export type CodexConfigOverrides = Record<string, unknown>;

export function toCodexMcpConfig(config: { mcpServers: Record<string, unknown> } | undefined): CodexConfigOverrides | undefined {
  if (!config) return undefined;
  const overrides: CodexConfigOverrides = {};
  for (const [serverId, rawSpec] of Object.entries(config.mcpServers)) {
    const translated = translateServer(rawSpec, serverId === "mulmoclaude");
    if (translated) overrides[`mcp_servers.${serverId}`] = translated;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function translateServer(rawSpec: unknown, required: boolean): Record<string, unknown> | null {
  if (!isRecord(rawSpec) || rawSpec.enabled === false) return null;
  if (rawSpec.type === "http" && typeof rawSpec.url === "string") {
    return httpServer(rawSpec, required);
  }
  if (rawSpec.type === "stdio" && typeof rawSpec.command === "string") {
    return stdioServer(rawSpec, required);
  }
  return null;
}

function httpServer(spec: Record<string, unknown>, required: boolean): Record<string, unknown> {
  const translated: Record<string, unknown> = { url: spec.url, required };
  if (isStringRecord(spec.headers)) translated.http_headers = spec.headers;
  return translated;
}

function stdioServer(spec: Record<string, unknown>, required: boolean): Record<string, unknown> {
  const translated: Record<string, unknown> = { command: spec.command, required };
  if (required) translated.default_tools_approval_mode = "approve";
  if (isStringArray(spec.args)) translated.args = spec.args;
  if (isStringRecord(spec.env)) translated.env = spec.env;
  return translated;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
