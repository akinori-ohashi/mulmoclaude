// The served index.html carries the bearer token in
// `<meta name="mulmoclaude-auth" content="…">`: the production handler and the
// Vite dev plugin substitute it on every request. Pure string work, so the
// page can read a token out of a re-fetched index.html without a DOM.

export const AUTH_TOKEN_META_NAME = "mulmoclaude-auth";

const META_TAGS = /<meta\b[^>]*>/gi;
const AUTH_META_NAME_ATTRIBUTE = new RegExp(`\\bname\\s*=\\s*"${AUTH_TOKEN_META_NAME}"`, "i");
const CONTENT_ATTRIBUTE = /\bcontent\s*=\s*"([^"]*)"/i;

/** The token `html` carries, `null` when the tag is missing or its content is
 *  empty — the same two cases `readAuthTokenFromMeta` reads as "no token". */
export function extractAuthTokenFromHtml(html: string): string | null {
  const authMetaTag = (html.match(META_TAGS) ?? []).find((tag) => AUTH_META_NAME_ATTRIBUTE.test(tag));
  if (authMetaTag === undefined) return null;
  const content = CONTENT_ATTRIBUTE.exec(authMetaTag)?.[1];
  return content === undefined || content === "" ? null : content;
}
