import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentMulmoScript",
  packageName: "@mulmoclaude/mulmoscript-plugin",
  apiNamespace: "mulmoScript",
  apiRoutes: {
    /** POST /api/mulmoScript/save — create-new (`script`) or
     *  reopen-existing (`filePath`) MulmoScript. The MCP bridge
     *  posts here. */
    save: { method: "POST", path: "/save" },
    /** POST /api/mulmoScript/update-beat — overwrite one beat in
     *  an existing script. */
    updateBeat: { method: "POST", path: "/update-beat" },
    /** POST /api/mulmoScript/update-script — overwrite the
     *  whole script. */
    updateScript: { method: "POST", path: "/update-script" },
    /** GET /api/mulmoScript/beat-image — read a beat's pre-rendered
     *  image (data URI or null). */
    beatImage: { method: "GET", path: "/beat-image" },
    /** GET /api/mulmoScript/beat-audio — read a beat's pre-rendered
     *  audio. */
    beatAudio: { method: "GET", path: "/beat-audio" },
    /** GET /api/mulmoScript/beat-movie — probe for a beat's generated
     *  video clip (moviePrompt / animated beats). Returns the wire
     *  path for `downloadMovie`, or null. */
    beatMovie: { method: "GET", path: "/beat-movie" },
    /** POST /api/mulmoScript/generate-beat-audio — render audio
     *  for a beat (long-running). */
    generateBeatAudio: { method: "POST", path: "/generate-beat-audio" },
    /** POST /api/mulmoScript/render-beat — render the beat's
     *  image (long-running). */
    renderBeat: { method: "POST", path: "/render-beat" },
    /** POST /api/mulmoScript/upload-beat-image — replace a beat's
     *  image with one supplied by the user. */
    uploadBeatImage: { method: "POST", path: "/upload-beat-image" },
    /** GET /api/mulmoScript/character-image — read a character
     *  reference image. */
    characterImage: { method: "GET", path: "/character-image" },
    /** POST /api/mulmoScript/render-character — render a
     *  character reference image. */
    renderCharacter: { method: "POST", path: "/render-character" },
    /** POST /api/mulmoScript/upload-character-image — replace a
     *  character reference image with one supplied by the user. */
    uploadCharacterImage: { method: "POST", path: "/upload-character-image" },
    /** GET /api/mulmoScript/movie-status — poll for a generated
     *  movie's status / availability. */
    movieStatus: { method: "GET", path: "/movie-status" },
    /** POST /api/mulmoScript/generate-movie — kick off movie
     *  generation (returns SSE stream). */
    generateMovie: { method: "POST", path: "/generate-movie" },
    /** GET /api/mulmoScript/download-movie — download a generated
     *  movie file. */
    downloadMovie: { method: "GET", path: "/download-movie" },
    /** GET /api/mulmoScript/pdf-status — poll for a generated PDF's
     *  status / availability (slide-mode, A4). */
    pdfStatus: { method: "GET", path: "/pdf-status" },
    /** POST /api/mulmoScript/generate-pdf — kick off PDF generation
     *  (slide mode, A4 size). Returns an SSE stream of image-render
     *  progress mirroring `generateMovie`; PDF assembly itself is a
     *  single short step after images are ready. */
    generatePdf: { method: "POST", path: "/generate-pdf" },
    /** GET /api/mulmoScript/download-pdf — download a generated
     *  PDF file. */
    downloadPdf: { method: "GET", path: "/download-pdf" },
  },
  mcpDispatch: "save",
  // mulmocast shells out to ffmpeg for movie/beat rendering. Without
  // it the editor still works but render/generate-movie degrades —
  // the host warns once at boot (#1385).
  requires: ["ffmpeg"],
});
