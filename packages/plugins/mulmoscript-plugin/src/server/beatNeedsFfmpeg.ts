import { BEAT_IMAGE_SENTINEL, type MulmoBeat, type MulmoMovieParams } from "mulmocast";

export interface BeatFfmpegContext {
  isPluginVideo: boolean;
  /** presentationStyle.movieParams — mulmocast merges it under every beat's own. */
  styleMovieParams: MulmoMovieParams | undefined;
  /** script.audioParams.suppressSpeech — lip sync then trims the BGM with ffmpeg. */
  suppressSpeech: boolean;
}

// mulmocast resizes a named first/last frame image with ffprobe for every beat, movie or not.
function hasNamedFrameImage(movieParams: MulmoMovieParams): boolean {
  return [movieParams.firstFrameImageName, movieParams.lastFrameImageName].some((name) => Boolean(name) && name !== BEAT_IMAGE_SENTINEL);
}

// Mirrors where mulmocast 2.22.1's generateBeatImage shells out to ffmpeg; a still beat does not. A sound effect
// only runs alongside a movie, which the movie checks already cover.
export function beatImageNeedsFfmpeg(beat: MulmoBeat | undefined, context: BeatFfmpegContext): boolean {
  if (!beat) return false;
  if (context.isPluginVideo || beat.moviePrompt || beat.image?.type === "movie") return true;
  if (beat.enableLipSync && context.suppressSpeech) return true;
  return hasNamedFrameImage({ ...context.styleMovieParams, ...beat.movieParams });
}
