import type { MulmoBeat } from "mulmocast";

// A still beat image renders without ffmpeg. Anything that makes or reads a movie needs it, and moviePrompt / lip
// sync / sound effects call paid generators before ffmpeg runs, so those are refused up front rather than failing late.
export function beatImageNeedsFfmpeg(beat: MulmoBeat | undefined, isPluginVideo: boolean): boolean {
  if (!beat) return false;
  if (isPluginVideo) return true;
  if (beat.image?.type === "movie") return true;
  return Boolean(beat.moviePrompt || beat.soundEffectPrompt || beat.enableLipSync);
}
