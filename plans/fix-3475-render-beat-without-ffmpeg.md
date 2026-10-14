# Render still beats without ffmpeg (#3475)

`renderBeat` refused every beat when ffmpeg was missing. mulmocast 2.22.1 (receptron/mulmocast-cli#1646) stopped
probing still PNGs with ffprobe, so a still beat image no longer needs ffmpeg.

- Bump `mulmocast` to `^2.22.1` (root, launcher, plugin peer/dev).
- `beatImageNeedsFfmpeg(beat, isPluginVideo)` (pure, `src/server/beatNeedsFfmpeg.ts`): true for a movie image, a plugin
  video (animated html_tailwind / remotion), `moviePrompt`, `soundEffectPrompt` or lip sync — the last three call paid
  generators before ffmpeg runs, so they are refused up front.
- `renderBeatOp` reads the beat and applies `ffmpegGuard()` only when that returns true. Movie / PDF generation keep
  their guard.
