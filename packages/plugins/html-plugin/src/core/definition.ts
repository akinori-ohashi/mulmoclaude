import type { ToolDefinition } from "gui-chat-protocol";
import { MAX_SUBMIT_TEXT_CHARS, SUBMIT_MESSAGE_TYPE } from "./submitMessage";
import { DIRECT_SUBMIT, SUBMIT_KEY_PARAM } from "./submitMode";

export const TOOL_NAME = "presentHtml";

// Single source of truth for the presentHtml tool schema, shared by
// MulmoClaude (host built-in shim re-exports this) and MulmoTerminal.
export const TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Present a complete, self-contained HTML page in the canvas — either new HTML (saved) or an existing page on disk (by path).",
  prompt: `Use ${TOOL_NAME} when the user asks for HTML output, dashboards, custom layouts, or interactive content. Provide EITHER \`html\` OR \`path\`, not both. \`html\` is a full self-contained document (\`<!DOCTYPE html>\`, \`<html>\`, \`<body>\`) with all CSS / JavaScript inlined or loaded via CDN; it is saved to \`artifacts/html/<YYYY>/<MM>/...\`, so when referencing other workspace assets use a relative path with exactly three \`../\` (example: \`<img src="../../../images/2026/04/foo.png">\`). \`path\` is the path of an HTML file that already exists — one you wrote under \`artifacts/html/...\`, a page in the workspace (\`docs/report.html\`), or an absolute path. It presents that page without re-saving a copy, and the user's edits in the view overwrite that same file. Do NOT read a page and re-send its markup as \`html\`, which would fork it into a copy. For the full path conventions and rationale, read \`config/helps/presenthtml.md\` in the workspace. When the page is for the user to DECIDE something (choose between mockups, settle open questions, adjust a plan) and hand the result back, give it a button that calls \`window.parent.postMessage({ type: "${SUBMIT_MESSAGE_TYPE}", text }, "*")\` with the decisions as plain text (at most ${MAX_SUBMIT_TEXT_CHARS} characters). The user reviews and may edit that text before it is sent, and it arrives as their next message — so do not wait or poll after presenting: finish your turn. A page written with \`html\` for exactly that purpose may pass \`submit: "${DIRECT_SUBMIT}"\`: its button then sends without the review step, provided every message also carries \`key: new URLSearchParams(location.hash.slice(1)).get("${SUBMIT_KEY_PARAM}")\` (the page's own URL carries it; a message without it goes to the review step). Never pass it for a page whose script you did not write; it is ignored with \`path\`.`,
  parameters: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description:
          "Complete, self-contained HTML document to save and present. Provide this OR `path`. See `config/helps/presenthtml.md` for the relative-path conventions when embedding workspace assets (images, charts, etc.).",
      },
      path: {
        type: "string",
        description:
          "Path to an existing HTML file to present without re-saving — workspace-relative (`docs/report.html`, `artifacts/html/lessons-x/lesson-001.html`) or absolute. The user's edits in the view overwrite this file. Provide this OR `html`.",
      },
      title: {
        type: "string",
        description: "Short label shown in the preview sidebar.",
      },
      submit: {
        type: "string",
        enum: [DIRECT_SUBMIT],
        description: `Only with \`html\`, for a page you wrote to hand the user's decisions back: \`"${DIRECT_SUBMIT}"\` sends its \`${SUBMIT_MESSAGE_TYPE}\` messages without the confirmation bar. Ignored with \`path\`.`,
      },
    },
    // Neither is individually required: the handler accepts `html` OR `path`.
    required: [],
  },
};

export default TOOL_DEFINITION;
