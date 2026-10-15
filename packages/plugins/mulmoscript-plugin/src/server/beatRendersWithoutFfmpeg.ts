import { BEAT_IMAGE_SENTINEL, type MulmoBeat, type MulmoMovieParams } from "mulmocast";

export interface BeatFfmpegContext {
  isPluginVideo: boolean;
  /** presentationStyle.movieParams — mulmocast merges it under every beat's own. */
  styleMovieParams: MulmoMovieParams | undefined;
  /** script.audioParams.suppressSpeech — lip sync then trims the BGM with ffmpeg. */
  suppressSpeech: boolean;
}

// Image plugins whose output is a still PNG, or no image at all (beat, voice_over).
const STILL_IMAGE_TYPES = new Set(["textSlide", "markdown", "chart", "mermaid", "html_tailwind", "slide", "vision", "beat", "voice_over"]);
// mulmocast probes a path-sourced `image` with ffprobe unless it has one of these extensions.
const STILL_FILE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function hasNamedFrameImage(movieParams: MulmoMovieParams): boolean {
  return [movieParams.firstFrameImageName, movieParams.lastFrameImageName].some((name) => Boolean(name) && name !== BEAT_IMAGE_SENTINEL);
}

function isStillImage(image: MulmoBeat["image"]): boolean {
  if (!image) return true;
  if (image.type === "image") return image.source.kind !== "path" || STILL_FILE.test(image.source.path);
  return STILL_IMAGE_TYPES.has(image.type);
}

// Lists what mulmocast 2.22.1's generateBeatImage renders WITHOUT ffmpeg; everything else needs it, so a beat shape
// this does not know about gets the clear "install ffmpeg" failure instead of an opaque one. It refuses some beats
// that would have worked (an unknown plugin type that happens to render a still), which is the intended trade.
export function beatRendersWithoutFfmpeg(beat: MulmoBeat | undefined, context: BeatFfmpegContext): boolean {
  if (!beat) return true;
  // generateBeatImage returns at an htmlPrompt before reading the image, movie, lip sync or frame fields.
  if (beat.htmlPrompt) return true;
  if (context.isPluginVideo || beat.moviePrompt) return false;
  if (beat.enableLipSync && context.suppressSpeech) return false;
  // Named frame images are resized with ffprobe for every beat, movie or not.
  if (hasNamedFrameImage({ ...context.styleMovieParams, ...beat.movieParams })) return false;
  return isStillImage(beat.image);
}
