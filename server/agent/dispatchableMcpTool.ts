// Pure helper split out of mcp-server.ts so the dispatch gate is unit-testable
// without booting the stdio JSON-RPC bridge.

interface NamedMcpTool {
  definition: { name: string };
}

/**
 * The pure MCP tool `tools/call` may dispatch for `name`, or undefined.
 *
 * A tool is dispatchable only when it is on the published surface — the same
 * list `tools/list` serves, which the parent narrows to the role's active
 * tools. The registry alone holds every tool for every role, so looking a name
 * up there would let a call reach a tool the role does not carry.
 */
export function findDispatchableMcpTool<T extends NamedMcpTool>(name: string, registry: readonly T[], publishedNames: ReadonlySet<string>): T | undefined {
  if (!publishedNames.has(name)) return undefined;
  return registry.find((tool) => tool.definition.name === name);
}
