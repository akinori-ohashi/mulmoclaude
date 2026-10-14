# Render still beats without ffmpeg (#3475)

`renderBeat` refused every beat when ffmpeg was missing. mulmocast 2.22.1 (receptron/mulmocast-cli#1646) stopped
probing still PNGs with ffprobe, so a still beat image no longer needs ffmpeg.

- Bump `mulmocast` to `^2.22.1` (root, launcher, plugin peer/dev).
- `beatRendersWithoutFfmpeg(beat, context)` (pure, `src/server/beatRendersWithoutFfmpeg.ts`) lists what mulmocast
  2.22.1's `generateBeatImage` renders without ffmpeg, and everything else needs it (fails closed: an unknown beat shape
  gets the clear message). Without ffmpeg: an `htmlPrompt` beat (mulmocast returns before the movie / frame fields),
  or a beat with no `moviePrompt`, no plugin video, no lip sync with `suppressSpeech`, no named first/last frame image
  in the merged style + beat `movieParams`, and an image that is absent, a still plugin type, or an `image` whose
  source is a url, base64 or a still-image path.
- `renderBeatOp` reads the beat and applies `ffmpegGuard()` only when that returns false. Movie / PDF generation keep
  their guard.
