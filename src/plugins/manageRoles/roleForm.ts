import type { CustomRole } from "./index";
import { isRecord, isStringArray, isUnknownArray } from "../../utils/types";

export const DEFAULT_ROLE_ICON = "person";
/** Any non-empty string; `""` is the form's "not set" option so it is never a
 *  stored value. Deliberately NOT checked against the alias list here: the
 *  host's `RoleSchema` is the single validator (it drops an unknown alias on
 *  the way to the agent), and reaching for the list would make this parser
 *  depend on host context it is not entitled to — plugin code cannot read
 *  `src/config/*`, and a parser that throws when the host has not booted is
 *  worse than one that carries a string through (#3104). */
const isStoredModel = (value: unknown): value is string => typeof value === "string" && value !== "";
const ROLE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Rebuilt field by field rather than asserted: the role list arrives as
// untrusted JSON and every consumer reads `name` / `icon` straight into
// the DOM, so a missing field has to fail here, not in a template.
const parseCustomRole = (value: unknown): CustomRole | null => {
  if (!isRecord(value)) return null;
  const { id, name, icon, prompt, availablePlugins, queries, model } = value;
  if (typeof id !== "string" || typeof name !== "string" || typeof icon !== "string" || typeof prompt !== "string") return null;
  if (!isStringArray(availablePlugins)) return null;
  const base: CustomRole = { id, name, icon, prompt, availablePlugins };
  // A non-string model is dropped, not fatal: a malformed field should cost
  // that field, not make the whole role vanish from the list.
  const role: CustomRole = isStoredModel(model) ? { ...base, model } : base;
  return isStringArray(queries) ? { ...role, queries } : role;
};

/** Parse an untrusted `/api/roles` payload into the role list. Returns
 *  null when the value isn't an array of well-formed roles, so callers
 *  keep the state they already had instead of rendering a partial list. */
export const parseCustomRoles = (value: unknown): CustomRole[] | null => {
  if (!isUnknownArray(value)) return null;
  const roles = value.flatMap((entry) => parseCustomRole(entry) ?? []);
  return roles.length === value.length ? roles : null;
};

/** Roles carried by a `POST /api/roles/manage` response, or null when the
 *  response holds no usable list. Null means "keep the list you already
 *  have" — never "the user has no roles", which is what an empty array
 *  would claim. */
export const parseManageRolesResult = (result: unknown): CustomRole[] | null => {
  if (!isRecord(result) || !isRecord(result.data)) return null;
  return parseCustomRoles(result.data.customRoles);
};

export interface RoleForm {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  selectedPlugins: string[];
  queriesText: string;
  /** `""` is "not set" — the app-wide setting decides. */
  model: string;
}

export type RoleFormErrorCode = "idRequired" | "idInvalid" | "nameRequired" | "idDuplicate";

export interface RoleFormError {
  code: RoleFormErrorCode;
  id: string;
}

export const isValidRoleId = (value: string): boolean => ROLE_ID_PATTERN.test(value);

// One newline-separated query per line; blank lines dropped, each trimmed.
export const parseQueriesText = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

// Single source of truth for form → role so create and edit can't drift.
// The icon fallback lives here: an empty icon field must become the default
// on BOTH paths (edit used to persist an empty icon, dropping it everywhere).
export const formToRole = (form: RoleForm): CustomRole => ({
  id: form.id.trim(),
  name: form.name.trim(),
  icon: form.icon.trim() || DEFAULT_ROLE_ICON,
  // Prompt is intentionally NOT trimmed — leading/trailing whitespace can be
  // meaningful in a system prompt.
  prompt: form.prompt,
  availablePlugins: form.selectedPlugins,
  queries: parseQueriesText(form.queriesText),
  // Omitted rather than set to "" when unset: the role file should carry no
  // key at all, so `role.model ?? settings.chatModel` falls through cleanly.
  ...(form.model ? { model: form.model } : {}),
});

/** A blank form. One factory so a field added to `RoleForm` cannot be
 *  forgotten at one of the several "start a new role" sites — which is the
 *  same class of omission that made a stray `model` key vanish before this
 *  was typed at all (#3104).
 *
 *  `icon` is PRE-FILLED with the default rather than left empty. `formToRole`
 *  would supply it either way, so the saved role is identical — but the create
 *  form is what a user looks at, and it showed `person` before this factory
 *  existed. A blank field there is a visible change dressed up as a
 *  refactor. */
export const emptyRoleForm = (): RoleForm => ({
  id: "",
  name: "",
  icon: DEFAULT_ROLE_ICON,
  prompt: "",
  selectedPlugins: [],
  queriesText: "",
  model: "",
});

export const roleToForm = (role: CustomRole): RoleForm => ({
  id: role.id,
  name: role.name,
  icon: role.icon,
  prompt: role.prompt,
  selectedPlugins: [...role.availablePlugins],
  queriesText: (role.queries ?? []).join("\n"),
  model: role.model ?? "",
});

// `excludeId` lets rename skip the role's own id when checking for duplicates.
export const validateRoleForm = (form: RoleForm, excludeId: string | null, existingIds: readonly string[]): RoleFormError | null => {
  const trimmedId = form.id.trim();
  if (!trimmedId) return { code: "idRequired", id: trimmedId };
  if (!isValidRoleId(trimmedId)) return { code: "idInvalid", id: trimmedId };
  if (!form.name.trim()) return { code: "nameRequired", id: trimmedId };
  if (existingIds.some((existing) => existing === trimmedId && existing !== excludeId)) {
    return { code: "idDuplicate", id: trimmedId };
  }
  return null;
};
