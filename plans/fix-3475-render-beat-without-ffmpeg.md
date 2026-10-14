# Render still beats without ffmpeg (#3475)

`renderBeat` refused every beat when ffmpeg was missing. mulmocast 2.22.1 (receptron/mulmocast-cli#1646) stopped
probing still PNGs with ffprobe, so a still beat image no longer needs ffmpeg.

- Bump `mulmocast` to `^2.22.1` (root, launcher, plugin peer/dev).
- `beatImageNeedsFfmpeg(beat, context)` (pure, `src/server/beatNeedsFfmpeg.ts`) mirrors where mulmocast 2.22.1's
  `generateBeatImage` shells out to ffmpeg: a movie image, a plugin video (animated html_tailwind / remotion),
  `moviePrompt`, lip sync with `suppressSpeech` (BGM trim), or a named first/last frame image in the merged
  style + beat `movieParams` (resized with ffprobe for every beat). A sound effect without a movie is dropped by
  mulmocast, and lip sync without `suppressSpeech` does not use ffmpeg.
- `renderBeatOp` reads the beat and applies `ffmpegGuard()` only when that returns true. Movie / PDF generation keep
  their guard.
