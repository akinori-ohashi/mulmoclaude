// What `getSchema` answers, given the two schema.json copies of one collection.
//
// The staging copy (`data/skills/<slug>/`) is what `putSchema` writes and what an
// agent should edit, so it wins. But discovery serves the ACTIVE copy
// (`.claude/skills/<slug>/`), and the skill-bridge only mirrors Write / Edit —
// a staging file changed through Bash or a script never reaches it. Returning the
// staging text alone then shows a schema the server is not running, with nothing
// to say so.

/** The note prefixed when the two copies differ. Kept separate from the JSON by a
 *  blank line so the schema below it is still copyable as-is. */
function divergenceNotice(slug: string): string {
  return [
    `manageCollection: NOTE — the schema below is data/skills/${slug}/schema.json, and it DIFFERS from .claude/skills/${slug}/schema.json, the copy the server is running.`,
    "The staging copy was changed without being mirrored (Write / Edit are mirrored; Bash and scripts are not).",
    `To apply it, pass the JSON below to putSchema. To keep the running schema instead, Read .claude/skills/${slug}/schema.json and putSchema that.`,
  ].join("\n");
}

/** The reply for `getSchema`: the staging copy when there is one, else the active
 *  copy; prefixed with a notice when both exist and differ. `null` when neither
 *  copy could be read. */
export function schemaReadReply(slug: string, staging: string | null, active: string | null): string | null {
  const primary = staging ?? active;
  if (primary === null) return null;
  if (staging === null || active === null || staging === active) return primary;
  return [divergenceNotice(slug), "", staging].join("\n");
}
