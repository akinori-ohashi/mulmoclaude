import type { ToolDefinition } from "gui-chat-protocol";
import { REMOTION_COMPONENT_GUIDE } from "mulmocast/remotion/guide";

export const TOOL_NAME = "presentMulmoScript";

// Single source of truth for the presentMulmoScript tool schema, shared by
// MulmoClaude (host built-in shim re-exports this) and MulmoTerminal.
// (Extracted byte-identical from the host definition; evolves here with the
// package version.)

const REMOTION_GUIDE_FILE = "remotion-component-guide.md";

/** The full usage reference: the MCP tool description, and also the prompt
 *  file a host that supports the split writes for the agent to Read. */
const SCRIPT_REFERENCE = `Save and present a MulmoScript story or presentation as a visual storyboard in the canvas.

Provide EXACTLY ONE of \`script\` or \`filePath\`:

1. **Create new** — pass \`script\` (full MulmoScript JSON). Server saves it to disk and presents it.
2. **Re-display existing** — pass \`filePath\` (the \`filePath\` returned by a previous call, e.g. "stories/my-story-1700000000000.json"; it is resolved against the workspace's \`artifacts/\` directory, NOT the workspace root — or an absolute path to a .json script anywhere on disk). Much cheaper than re-sending the full script. Use whenever the user wants to revisit a presentation that was already created in this workspace.
3. **Edit one beat** — pass \`filePath\` PLUS \`beatIndex\` and \`beat\`. Replaces that one beat and presents the result. **Use this whenever the user asks to change part of an existing presentation** — re-sending the whole script instead wastes tokens and overwrites anything edited in the canvas meanwhile.

Optional \`autoGenerateMovie: true\` kicks off movie generation in the background, so the final video is ready by the time the user opens the canvas. Movie generation is expensive (multiple image + audio API calls + video encoding) — only set this when the user has explicitly asked for the movie. Default \`false\`.

Provider rules for new scripts:
- \`speechParams.speakers.<name>.provider\`: \`"gemini"\` — pairs with Gemini voices like \`"Kore"\`, \`"Aoede"\`, \`"Puck"\`. Do NOT use \`"google"\` here — that routes to Google Cloud TTS, where Gemini-class voices fail with "This voice requires a model name to be specified." unless an explicit \`model\` is set.
- \`imageParams.provider\`: \`"google"\`
- \`movieParams.provider\`: \`"google"\`
- Do NOT add a top-level \`provider\` field to \`speechParams\` — provider belongs per-speaker only.

Required structure:

{
  "$mulmocast": { "version": "1.1" },
  "title": "The Life of a Star",
  "description": "A short educational explainer about stellar evolution",
  "lang": "en",
  "speechParams": {
    "speakers": {
      "Presenter": {
        "provider": "gemini",
        "voiceId": "Kore",
        "displayName": { "en": "Presenter" }
      }
    }
  },
  "imageParams": { "provider": "google", "model": "gemini-3.1-flash-image-preview" },
  "movieParams": { "provider": "google", "model": "veo-3.1-generate" },
  "beats": [
    {
      "speaker": "Presenter",
      "text": "Narration spoken aloud for this beat.",
      "imagePrompt": "Detailed description — AI generates the image"
    },
    {
      "speaker": "Presenter",
      "text": "Bullet point beat.",
      "image": { "type": "textSlide", "slide": { "title": "Slide Title", "bullets": ["Point one", "Point two"] } }
    },
    {
      "speaker": "Presenter",
      "text": "Markdown beat.",
      "image": { "type": "markdown", "markdown": "## Heading\\n\\nBody text here." }
    },
    {
      "speaker": "Presenter",
      "text": "Chart beat — use for data, comparisons, trends.",
      "image": { "type": "chart", "title": "Chart Title", "chartData": { "type": "bar", "data": { "labels": ["A", "B", "C"], "datasets": [{ "label": "Series", "data": [10, 20, 30] }] } } }
    },
    {
      "speaker": "Presenter",
      "text": "Diagram beat — use for flows, architectures, relationships.",
      "image": { "type": "mermaid", "title": "Diagram Title", "code": { "kind": "text", "text": "graph TD\\n  A[Start] --> B[Process] --> C[End]" } }
    },
    {
      "speaker": "Presenter",
      "text": "Rich interactive beat — use for custom layouts, animations, or anything that benefits from HTML/CSS.",
      "image": { "type": "html_tailwind", "html": "<div class=\\"flex items-center justify-center h-full text-4xl font-bold text-blue-600\\">Hello World</div>" }
    },
    {
      "speaker": "Presenter",
      "text": "AI video beat.",
      "moviePrompt": "Detailed description — AI generates the video clip"
    }
  ]
}

Beat visual options (choose one per beat):
- "imagePrompt": "..."  → top-level string field — AI generates an image from the prompt
- "moviePrompt": "..."  → top-level string field — AI generates a video clip from the prompt
- "image": { "type": "textSlide", "slide": { "title", "subtitle"?, "bullets"? } }
- "image": { "type": "markdown", "markdown": "..." }
- "image": { "type": "chart", "title": "...", "chartData": { "type": "bar"|"line"|"pie"|..., "data": { "labels": [...], "datasets": [...] } } }  ← PREFER for data/numbers/comparisons. chartData is a full Chart.js config: labels/datasets go under "data", not at the top level.
- "image": { "type": "mermaid", "title": "...", "code": { "kind": "text", "text": "..." } }  ← PREFER for flows/diagrams/relationships
- "image": { "type": "html_tailwind", "html": "...", "script"?: "..." }  ← PREFER for rich layouts, animations, custom visuals
- "image": { "type": "remotion", "prompt": "..." | "code": {...}, "fps"?: 30 }  → a Remotion animation ("fps" is optional, 1–60, default 30). ONLY use when the user asks for Remotion or is known to have the optional remotion packages installed — without them generation fails. Cannot be combined with "moviePrompt" on the same beat. Give EXACTLY ONE of:
  - "prompt": "scene description" → mulmocast has Claude Code write the component. Slow and costly (several Claude calls per scene). Choose it when the user is happy to leave the scene to it. Keep the look consistent across these beats with a top-level "remotionParams": { "brief": "palette, type, mood" }.
  - "code": { "kind": "path", "path": "scenes/intro.tsx" } (relative to the script's folder) or { "kind": "text", "text": "<TSX source>" } → YOU write the finished component and mulmocast renders it as is. Choose it when the user wants to refine the scene with you in the conversation, or when you can write it yourself. Read the REMOTION_COMPONENT_GUIDE first (the ${REMOTION_GUIDE_FILE} file beside this one, or the section of that name at the end of this tool's description): one self-contained file (no relative imports), only the allowed imports. If rendering fails, mulmocast stops and names the file and the error — fix the component and render again.

IMPORTANT: "imagePrompt" and "moviePrompt" are plain string fields on the beat, NOT nested under "image".`;

const REFERENCE_FILE = "presentMulmoScript.md";

/** The contract for a remotion beat's \`code\`, taken from mulmocast so it follows its renderer. */
const REMOTION_GUIDE = `# REMOTION_COMPONENT_GUIDE — how to write a remotion beat's \`code\`

${REMOTION_COMPONENT_GUIDE}`;

/** Injected into the system prompt instead of the full reference by a host that
 *  supports `promptCompact` / `promptFiles` (`@mulmoclaude/core/prompt-files`). */
const PROMPT_COMPACT = [
  "Save and present a MulmoScript story or presentation as a storyboard in the canvas.",
  "Pass exactly one of `script` (a new presentation) or `filePath` (re-display an existing one; add `beatIndex` + `beat` to replace one beat — prefer that over re-sending the whole script).",
  "Set `autoGenerateMovie` only when the user has asked for the movie — it is expensive.",
  "Before writing or editing a script, Read {{promptFilesDir}}/" + REFERENCE_FILE + " for the required structure, provider rules and beat types.",
  "Before writing a remotion beat's `code` component, Read {{promptFilesDir}}/" + REMOTION_GUIDE_FILE + ".",
].join(" ");

/** `ToolDefinition` plus the optional prompt split; hosts that do not know it
 *  ignore the extra fields and keep using `description`. */
type ToolDefinitionWithPromptFiles = ToolDefinition & { promptCompact: string; promptFiles: Record<string, string> };

export const TOOL_DEFINITION: ToolDefinitionWithPromptFiles = {
  type: "function",
  name: TOOL_NAME,
  description: [SCRIPT_REFERENCE, REMOTION_GUIDE].join("\n\n"),
  promptCompact: PROMPT_COMPACT,
  promptFiles: { [REFERENCE_FILE]: SCRIPT_REFERENCE, [REMOTION_GUIDE_FILE]: REMOTION_GUIDE },
  parameters: {
    type: "object",
    properties: {
      script: {
        type: "object",
        description:
          "Complete MulmoScript JSON for a NEW presentation. Must include $mulmocast, speechParams, imageParams, movieParams, and beats array. Always populate the top-level 'description' field with a concise 1–2 sentence summary of the presentation. Do NOT pass alongside `filePath`.",
        additionalProperties: true,
      },
      filename: {
        type: "string",
        description:
          "Optional filename without extension. Defaults to a slug of the script title. Only meaningful with `script`; ignored when `filePath` is given.",
      },
      filePath: {
        type: "string",
        description:
          "Path of an EXISTING MulmoScript JSON file. Either a relative path as returned by a previous call (e.g. 'stories/my-story-1700000000000.json'), resolved against the workspace's `artifacts/` directory, not the workspace root ('artifacts/stories/…' is also accepted) — or an ABSOLUTE path to a .json script anywhere on disk (e.g. '/Users/me/decks/keynote.json'), for a script that was not saved by this tool. Generated output (movie, PDF, beat media) is written beside the script, so an absolute script's artifacts land in ITS directory, not the workspace. Use this to re-display an existing script instead of resending the full JSON. Do NOT pass alongside `script`.",
      },
      beatIndex: {
        type: "number",
        description: "0-based index of the beat to replace. Requires `filePath` and `beat`. Omit to re-display the script unchanged.",
      },
      beat: {
        type: "object",
        description: "The replacement beat, complete (it overwrites the old one — it is not merged). Requires `filePath` and `beatIndex`.",
        additionalProperties: true,
      },
      autoGenerateMovie: {
        type: "boolean",
        description:
          "When true, the server starts movie generation in the background after save/load. The user does NOT need to open the canvas — progress streams via the existing session channel. Default false. Only set true when the user has explicitly asked for the movie; generation is expensive.",
      },
    },
    required: [],
  },
};
