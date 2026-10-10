// Read the bearer auth token that the server embeds into the
// `<meta name="mulmoclaude-auth" content="…">` tag of index.html (#272).
// Isolated in this tiny DOM-scoped module so it lives under
// `src/utils/dom/` where ESLint already configures browser globals —
// avoids promoting `src/main.ts` into the browser-globals override.
//
// Returns `null` when:
//   - the meta tag is missing (placeholder never injected — shouldn't
//     happen in production but guards against it)
//   - the content attribute is empty (server embedded empty = no token
//     available; every subsequent API call will 401, which is the
//     correct dev-time signal)

import { AUTH_TOKEN_META_NAME } from "../auth/authTokenHtml";

export function readAuthTokenFromMeta(): string | null {
  const meta = document.querySelector(`meta[name="${AUTH_TOKEN_META_NAME}"]`);
  if (meta === null) return null;
  const content = meta.getAttribute("content");
  if (content === null || content === "") return null;
  return content;
}
