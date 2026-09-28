// Which role a caller OTHER than the role selector may start a chat in.
//
// A plugin — and through it a sandboxed custom view, which names the role in a
// postMessage — can ask for a role by id. Roles carry their own system prompt,
// tool set and model, so honouring an id that names no selectable role would let
// the caller pick an assistant the user cannot reach from the selector. Debug
// roles are excluded for that reason: they are in the merged list but the
// selector hides them outside dev mode. The remote-host startChat handler asks
// this same function, so the rule lives here once.
//
// Returns `undefined` rather than a default, so each caller keeps its own answer
// to "then what": the phone's channel handler refuses the request outright, while
// a desktop chat falls back to a role the user themselves chose.

/** The part of a role this decision reads — the merged list satisfies it. */
export interface RoleCandidate {
  id: string;
  isDebugRole?: boolean | undefined;
}

export function resolveRequestedRoleId(requested: string | undefined, roles: readonly RoleCandidate[]): string | undefined {
  // An empty id is not a request. `RoleSchema` does not forbid `id: ""`, so a
  // role could otherwise match it and be honoured.
  if (!requested) return undefined;
  const namedRole = roles.find((role) => role.id === requested);
  return namedRole && namedRole.isDebugRole !== true ? namedRole.id : undefined;
}
