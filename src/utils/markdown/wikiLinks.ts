// `[[wiki-link]]` → `<span class="wiki-link">` as a marked inline extension.
//
// It used to be a string rewrite applied BEFORE `marked.parse`, and that is
// exactly the shape `wikiEmbeds.ts` documents as the wrong one: a walker over
// the raw markdown has no idea it is inside a fence, so it injected its span
// into code blocks and the reader saw the markup instead of their text. Once
// #3151 made that span carry a per-render nonce, the reader saw a UUID too
// (#3164).
//
// As a tokenizer the question does not arise — marked never reaches `code`
// content — and the span stops being author raw HTML, so the raw-HTML policy
// has no reason to strip its class and the whole app-markup nonce mechanism it
// needed goes away with it.

import type { MarkedExtension } from "marked";
import { escapeHtml, parseWikiLink, WIKI_LINK_PATTERN } from "@mulmoclaude/core/wiki";

/** Core's `WIKI_LINK_PATTERN`, anchored to the start of the remaining source.
 *
 *  Built FROM that pattern rather than restated so the two cannot drift: a link
 *  that renders clickable but that the lint / graph / backlinks never match is
 *  precisely what the shared constant exists to prevent, and core carries a
 *  parity test pinning its own hand-rolled walker to it. Rebuilt (not reused)
 *  because the shared one is `/g` and carries `lastIndex`. */
const WIKI_LINK_TOKEN = new RegExp(`^(?:${WIKI_LINK_PATTERN.source})`);

/** Wiki links render on the wiki surface only.
 *
 *  The extension is registered on the GLOBAL marked, which chat and every
 *  other markdown view share, so an always-on tokenizer would silently turn
 *  `[[Foo]]` in a chat message from literal text into a link. That is a
 *  product change nobody asked for, so the tokenizer stays inert outside the
 *  window `withWikiLinks` opens.
 *
 *  Unlike the nonce this replaces, the flag needs no unforgeability: it decides
 *  whether `[[x]]` becomes a link, which is not a capability an author gains
 *  anything by forging — and they cannot reach it from markdown regardless. */
let renderingWikiPage = false;

/** Runs `parse` with wiki links enabled. Synchronous by contract: marked's
 *  tokenizers run inline, so the window closes before any other render starts.
 *  Restores rather than clears, so a nested render cannot disable an outer
 *  one's links. */
export function withWikiLinks<T>(parse: () => T): T {
  const outer = renderingWikiPage;
  renderingWikiPage = true;
  try {
    return parse();
  } finally {
    renderingWikiPage = outer;
  }
}

interface WikiLinkToken {
  type: "wikiLink";
  raw: string;
  target: string;
  display: string;
}

export const wikiLinkExtension: MarkedExtension = {
  extensions: [
    {
      name: "wikiLink",
      level: "inline",
      start(src: string): number | undefined {
        const index = src.indexOf("[[");
        return index === -1 ? undefined : index;
      },
      tokenizer(src: string): WikiLinkToken | undefined {
        if (!renderingWikiPage) return undefined;
        const [raw, inner] = WIKI_LINK_TOKEN.exec(src) ?? [];
        if (raw === undefined || inner === undefined) return undefined;
        const { target, display } = parseWikiLink(inner);
        return { type: "wikiLink", raw, target, display };
      },
      renderer(token): string {
        // Annotated destructure rather than a cast, matching `wikiEmbeds.ts`.
        // Defensive despite the tokenizer being the only producer: a token
        // shape that drifts should render nothing, not `undefined`.
        const { target, display, raw }: { target?: unknown; display?: unknown; raw: string } = token;
        if (typeof target !== "string" || typeof display !== "string") return escapeHtml(raw);
        // Both halves are escaped rather than trusted: `data-page` lands in an
        // attribute and `display` in text, and the source is a page anyone with
        // write access can edit.
        return `<span class="wiki-link" data-page="${escapeHtml(target)}">${escapeHtml(display)}</span>`;
      },
    },
  ],
};
