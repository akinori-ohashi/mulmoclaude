# Release @mulmoclaude/mulmoscript-plugin 5.4.0

The browser beat preview (#3476, #3478, #3479) is on main but npm still serves 5.3.0.

- Bump the plugin to 5.4.0 (minor: new preview feature).
- Raise the peer floors to the versions the preview was built and tested against: `mulmocast ^2.21.0`,
  `@mulmocast/deck ^2.1.0`, `@mulmocast/types ^2.21.0`. The preview reads the fragment's `requires` and draws
  chart / mermaid as deck figure slides, which older mulmocast does not produce.
- Sweep the launcher's range to `^5.4.0` (launcher-sync).
- After merge: tag `@mulmoclaude/mulmoscript-plugin@5.4.0`, the user runs `npm publish`, GH release `--latest=false`.
