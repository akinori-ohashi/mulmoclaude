// Pure helpers that look up role metadata from a list of roles.
// Taking the role list as a parameter (instead of reading a Vue ref)
// keeps these dependency-free and unit-testable.

import type { Role } from "../../config/roles";

// Material Icon names are lowercase letters, DIGITS and underscores.
//
// Verified against the shipped list rather than assumed: all 2122 names in
// `material-icons/index.d.ts` use exactly the charset `[0-9_a-z]`, and this
// pattern rejects none of them. A letters-only pattern rejected 151 real icons
// — every numeric one (`123`, `360`, `10k`, `3d_rotation`, `18_up_rating`) —
// and the role silently fell back to the robot glyph instead.
//
// `collection/core/iconGlyph.ts` asks the same question of Material SYMBOLS
// and is deliberately a separate copy: it is a different icon set with its own
// name list, so each is pinned by a sweep over ITS OWN shipped names. Sharing
// one pattern would only hide the day the two sets diverge.
//
// Custom roles may have stored an emoji or other freeform value in the icon
// field; fall back to a generic icon in that case so we don't render the
// literal text inside a Material Icons span.
const MATERIAL_ICON_RE = /^[a-z0-9_]+$/;

// `smart_toy` (robot glyph) is used for both fallback cases —
// "role not found" and "role icon isn't a valid Material Icon name".
// Reserved specifically to avoid collision with `star`, which is the
// PinToggle glyph for collection shortcuts; using `star` here would
// make an unknown role look identical to a pinned collection (#1684).
const FALLBACK_ICON = "smart_toy";

/** Classes that bound what a role icon can paint, for the spans that render
 *  `roleIcon`'s result.
 *
 *  The pattern above says "shaped like a name", NOT "is a name the font
 *  carries" — and it never could without shipping all 2122 of them to the
 *  browser and keeping that copy in step with the font. So an unresolvable
 *  value still reaches the icon font, where it is laid out as ordinary TEXT:
 *  measured, `not_a_glyph` draws 176px against a real glyph's 16px, which
 *  pushes the row apart. That is not new — `not_a_glyph`, `aaaa` and the far
 *  likelier `schoool` all passed the previous letters-only pattern too, and
 *  the same failure took out a collection header in #2605.
 *
 *  A resolved ligature is EXACTLY 1em wide, so capping the box at 1em never
 *  touches a real icon and contains every miss. `em` rather than a fixed size
 *  because the callers range from `text-sm` to `text-5xl`.
 *
 *  All SEVEN spans that render this function's result carry it — the value
 *  travels as a prop, so grepping for the call site alone finds four of them:
 *    · `App.vue` (empty-session hero, text-5xl)
 *    · `StackView.vue` ×2 (stack-mode header + its mirror of that hero)
 *    · `SessionSidebar.vue` (sidebar header)
 *    · `RoleSelector.vue` ×2 (trigger + each option)
 *    · `SessionRoleIcon.vue` (session tabs / history)
 *
 *  The three RAW `role.icon` renderers are deliberately NOT in that list
 *  (`plugins/manageRoles/View.vue`, `plugins/manageRoles/Preview.vue`,
 *  `components/RolesView.vue`): those screens bypass this function to show
 *  what you actually typed, emoji included, and an emoji is 1.25em — this cap
 *  would crop it. Bounding them needs the classify-then-render treatment in
 *  `collection/core/iconGlyph.ts`, not this — tracked in #3003. */
export const ROLE_ICON_CONTAINMENT = "inline-block w-[1em] overflow-hidden";

export function roleIcon(roles: Role[], roleId: string): string {
  const icon = roles.find((role) => role.id === roleId)?.icon ?? FALLBACK_ICON;
  return MATERIAL_ICON_RE.test(icon) ? icon : FALLBACK_ICON;
}

export function roleName(roles: Role[], roleId: string): string {
  return roles.find((role) => role.id === roleId)?.name ?? roleId;
}
