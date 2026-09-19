// Which workspace files the file API treats as PLAIN TEXT.
//
// Membership decides three things at once: the Files view previews the file,
// the `/api/files/content` write routes accept an edit to it, and it is not
// shunted to the binary fallback — which offers "Open in OS", a handler
// spawned on the SERVER's own desktop. Under Docker / WSL2 / a remote host
// there is no desktop there, so for anything outside this set the file is
// unreachable through the UI entirely (#3213).
//
// Curated on purpose rather than resolved through a MIME database: this repo
// writes TypeScript, and `mime-db` types `.ts` as `video/mp2t`. A lookup
// would classify every source file in the workspace as a video stream.
//
// What stays OUT, and why:
//   - Anything whose job is to hold a secret: `.env*`, `.pem`, `.key`,
//     `.crt`, `.npmrc`, `.netrc`, `.htpasswd`, `.tfstate`, `.p12`, `.pfx`.
//     `.env` used to be in this set, which made `/files/content?path=.env`
//     serve the workspace credentials as JSON text over an open CORS
//     endpoint. `isSensitivePath` now refuses those by name as well.
//   - Formats that are text only sometimes: `.plist` (a binary plist is
//     also a plist), `.rtf` (control words, not prose), `.xlsx` / `.docx` /
//     `.pptx` (zip containers, whatever the highlighter's alias list says).
//     Those reach the user through the fallback's Download button instead.

const DOC_EXTENSIONS = [".md", ".markdown", ".mkd", ".mdx", ".txt", ".text", ".rst", ".adoc", ".asciidoc", ".tex", ".latex", ".bib", ".org", ".nfo", ".log"];

// Every mainstream subtitle / caption / lyric container is plain UTF-8. `.srt`
// is the one #3213 was reported against; the rest fail identically.
const SUBTITLE_EXTENSIONS = [".srt", ".vtt", ".ass", ".ssa", ".sbv", ".sub", ".lrc"];

// Playlists and cue sheets — text files that sit beside the media they index.
const PLAYLIST_EXTENSIONS = [".m3u", ".m3u8", ".pls", ".cue"];

// Serialization and config. `.xsd` and `.map` are here on evidence: a real
// workspace carries hundreds of the former and a dozen of the latter, and both
// used to read as "Binary file — preview not supported". `.toml` / `.xml` are
// types the attachment store already accepts on upload.
const DATA_EXTENSIONS = [
  ".json",
  ".jsonl",
  ".ndjson",
  ".jsonc",
  ".json5",
  ".geojson",
  ".topojson",
  ".map",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",
  ".csv",
  ".tsv",
  ".xml",
  ".xsd",
  ".xsl",
  ".xslt",
  ".dtd",
  ".rss",
  ".atom",
  ".opml",
  ".webmanifest",
  ".ics",
  ".vcf",
  ".gpx",
  ".kml",
  ".ipynb",
  ".proto",
  ".graphqls",
  ".avsc",
  ".edn",
  ".utf8",
];

// Markup, styles and the template languages that produce them.
const WEB_EXTENSIONS = [
  ".html",
  ".htm",
  ".xhtml",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".vue",
  ".svelte",
  ".astro",
  ".hbs",
  ".mustache",
  ".ejs",
  ".pug",
  ".njk",
  ".liquid",
  ".erb",
  ".jinja",
  ".jinja2",
  ".twig",
  ".xaml",
  ".razor",
  ".cshtml",
  ".resx",
];

const SOURCE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".coffee",
  ".py",
  ".pyi",
  ".rb",
  ".rake",
  ".gemspec",
  ".php",
  ".pl",
  ".pm",
  ".lua",
  ".tcl",
  ".r",
  ".jl",
  ".m",
  ".mm",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".groovy",
  ".swift",
  ".dart",
  ".cs",
  ".vb",
  ".fs",
  ".fsi",
  ".fsx",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hh",
  ".hxx",
  ".ino",
  ".d",
  ".zig",
  ".nim",
  ".v",
  ".sv",
  ".svh",
  ".vhd",
  ".vhdl",
  ".asm",
  ".s",
  ".hs",
  ".lhs",
  ".ml",
  ".mli",
  ".elm",
  ".purs",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".clj",
  ".cljs",
  ".cljc",
  ".scm",
  ".rkt",
  ".lisp",
  ".el",
  ".sml",
  ".pas",
  ".pp",
  ".f90",
  ".f95",
  ".for",
  ".sql",
  ".graphql",
  ".gql",
  ".vim",
];

const SHELL_EXTENSIONS = [".sh", ".bash", ".zsh", ".fish", ".ksh", ".ps1", ".psm1", ".psd1", ".bat", ".cmd", ".awk", ".sed"];

// Build and infrastructure descriptors. `.rules` is a Firestore/Storage rules
// file, which this project's own workspace carries.
const BUILD_EXTENSIONS = [
  ".gradle",
  ".cmake",
  ".mk",
  ".mak",
  ".bzl",
  ".bazel",
  ".nix",
  ".tf",
  ".tfvars",
  ".hcl",
  ".jsonnet",
  ".libsonnet",
  ".rules",
  ".service",
  ".desktop",
  ".in",
  ".gitignore",
  ".gitattributes",
  ".dockerignore",
  ".editorconfig",
];

const PATCH_EXTENSIONS = [".diff", ".patch", ".lock"];

// ShapeScript source, written by this app's own `artifacts/shapes/` tools.
// A file the product generates and then refused to show is the sharpest form
// of #3213, so generated text artifacts get their own group: anything added
// to the workspace by a tool here belongs in it.
const GENERATED_ARTIFACT_EXTENSIONS = [".shape"];

export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ...DOC_EXTENSIONS,
  ...SUBTITLE_EXTENSIONS,
  ...PLAYLIST_EXTENSIONS,
  ...DATA_EXTENSIONS,
  ...WEB_EXTENSIONS,
  ...SOURCE_EXTENSIONS,
  ...SHELL_EXTENSIONS,
  ...BUILD_EXTENSIONS,
  ...PATCH_EXTENSIONS,
  ...GENERATED_ARTIFACT_EXTENSIONS,
]);
